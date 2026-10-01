import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const app=express();
const PORT=process.env.PORT||10000;

app.use(express.json({limit:"250kb"}));
app.use(express.static(path.join(__dirname,"public")));

const CJ_BASE="https://developers.cjdropshipping.com/api2.0/v1";
const CJ_PRODUCT_ID=process.env.CJ_PRODUCT_ID||"1714942237055922176";
const TARGET_MARGIN=Number(process.env.GRINGA_TARGET_MARGIN||"0.30");
const MIN_PROFIT=Number(process.env.GRINGA_MIN_PROFIT||"10");
const PAYPAL_VARIABLE_RATE=Number(process.env.GRINGA_PAYPAL_VARIABLE_RATE||"0.064");
const PAYPAL_FIXED_FEE=Number(process.env.GRINGA_PAYPAL_FIXED_FEE||"0.30");
const TAX_RATE=Number(process.env.GRINGA_TAX_RATE||"0");
const orderMemory=new Map();
const quoteMemory=new Map();
const catalogCache={list:null,expires:0};
const detailCache=new Map();

function env(n){if(!process.env[n])throw new Error(n+" is not configured on Render.");return process.env[n]}
function clean(v,n=500){return String(v??"").trim().slice(0,n)}

async function cj(path,{method="GET",query,body}={}) {
  const u=new URL(CJ_BASE+path);
  if(query) for(const [k,v] of Object.entries(query)) {
    if(v!==undefined&&v!==null&&v!=="") u.searchParams.set(k,String(v));
  }
  const r=await fetch(u,{
    method,
    headers:{"CJ-Access-Token":env("CJ_ACCESS_TOKEN"),"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.result===false||d.success===false) throw new Error(d.message||d.msg||("CJ HTTP "+r.status));
  return d;
}

function paypalBase(){
  return (process.env.PAYPAL_ENVIRONMENT||"live").toLowerCase()==="sandbox"
    ?"https://api-m.sandbox.paypal.com"
    :"https://api-m.paypal.com";
}

async function paypalToken(){
  const id=env("PAYPAL_CLIENT_ID"),secret=env("PAYPAL_CLIENT_SECRET");
  const r=await fetch(paypalBase()+"/v1/oauth2/token",{
    method:"POST",
    headers:{
      Authorization:"Basic "+Buffer.from(id+":"+secret).toString("base64"),
      "Content-Type":"application/x-www-form-urlencoded"
    },
    body:"grant_type=client_credentials"
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token) throw new Error(d.error_description||d.error||"PayPal authentication failed.");
  return d.access_token;
}

async function paypal(path,{method="GET",body}={}) {
  const r=await fetch(paypalBase()+path,{
    method,
    headers:{
      Authorization:"Bearer "+await paypalToken(),
      "Content-Type":"application/json",
      Prefer:"return=representation"
    },
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.details?.[0]?.description||d.message||d.error||"PayPal request failed.");
  return d;
}

function variants(d){
  return (Array.isArray(d?.variants)?d.variants:[])
    .map(v=>({
      vid:String(v.vid||v.id||""),
      sku:String(v.variantSku||v.sku||""),
      name:String(v.variantKey||v.variantNameEn||v.variantName||v.variantkeyen||v.variantKeyEn||""),
      image:String(v.variantImage||v.image||""),
      cost:Number(v.variantSellPrice??v.sellPrice??v.nowPrice??v.price??0)
    }))
    .filter(v=>v.vid&&v.sku&&Number.isFinite(v.cost)&&v.cost>0);
}

function roundUp99(n){
  return Math.ceil((Number(n)||0)*100)/100;
}

function salePriceForCost(cost,{includeFixed=true,minProfit=MIN_PROFIT}={}){
  const n=Number(cost)||0;
  if(n<=0) throw new Error("Invalid supplier cost.");
  const variable=PAYPAL_VARIABLE_RATE+TAX_RATE;
  const margin=TARGET_MARGIN;
  if(variable+margin>=1) throw new Error("Pricing configuration is invalid: fees + margin must stay below 100%.");
  const fixed=includeFixed?PAYPAL_FIXED_FEE:0;
  const forMargin=(n+fixed)/(1-variable-margin);
  const forMinimumProfit=(n+fixed+minProfit)/(1-variable);
  return Math.max(0.99,roundUp99(Math.max(forMargin,forMinimumProfit)));
}

function retailPrice(cost){
  return salePriceForCost(cost,{includeFixed:true,minProfit:MIN_PROFIT});
}

function shippingSalePrice(cost){
  return salePriceForCost(cost,{includeFixed:false,minProfit:0});
}

function normalizeDetail(d,pid){
  const vs=variants(d).map(v=>({...v,price:retailPrice(v.cost)}));
  if(!vs.length) throw new Error("CJ returned no purchasable variants for this product.");
  const imgs=Array.from(new Set([
    d.bigImage,d.bigimg,
    ...(Array.isArray(d.productImageSet)?d.productImageSet:[])
  ].filter(Boolean).map(String)));
  const first=vs.reduce((m,v)=>Math.min(m,v.price),Infinity);
  return {
    id:"gringa-cj-"+pid,
    cjProductId:pid,
    name:String(d.productNameEn||d.nameen||"GRINGA Edit"),
    price:first,
    image:imgs[0]||"",
    images:imgs,
    description:String(d.description||"Selected from our fulfillment partner."),
    category:String(d.oneCategoryName||d.twoCategoryName||"Selected edit"),
    variants:vs
  };
}

async function catalogDetail(pid){
  const key=String(pid);
  const cached=detailCache.get(key);
  if(cached&&cached.expires>Date.now()) return cached.value;

  const r=await cj("/product/query",{query:{pid:key}});
  const d=r.data||{};
  const p=normalizeDetail(d,key);
  detailCache.set(key,{value:p,expires:Date.now()+10*60*1000});
  return p;
}

async function catalogList(){
  if(catalogCache.list&&catalogCache.expires>Date.now()) return catalogCache.list;

  const primary=await catalogDetail(CJ_PRODUCT_ID);
  const rows=[];
  for(let page=1;page<=5 && rows.length<60;page++){
    const r=await cj("/product/listV2",{
      query:{
        page,
        size:20,
        sort:"desc",
        orderBy:3,
        features:"enable_description,enable_category"
      }
    });
    const groups=Array.isArray(r.data?.content)?r.data.content:[];
    const pageRows=groups.flatMap(x=>Array.isArray(x?.productList)?x.productList:[]);
    if(!pageRows.length) break;
    rows.push(...pageRows);
  }

  const summaries=rows
    .filter(x=>x?.id&&x.id!==CJ_PRODUCT_ID&&x.saleStatus!=="0"&&x.bigImage)
    .map(x=>{
      const supplier=Number(x.nowPrice??x.sellPrice??0);
      return {
        id:"gringa-cj-"+String(x.id),
        cjProductId:String(x.id),
        name:String(x.nameEn||x.productNameEn||"GRINGA Edit"),
        price:supplier>0?retailPrice(supplier):29.99,
        image:String(x.bigImage||""),
        images:x.bigImage?[String(x.bigImage)]:[],
        description:String(x.description||"Selected from our fulfillment partner."),
        category:String(x.oneCategoryName||x.twoCategoryName||x.threeCategoryName||"Selected edit"),
        variants:null
      };
    })
    .filter(x=>x.image);

  const list=[{
    id:primary.id,
    cjProductId:primary.cjProductId,
    name:primary.name,
    price:primary.price,
    image:primary.image,
    images:primary.images,
    description:primary.description,
    category:"Fashion",
    variants:null
  }];

  for(const p of summaries){
    if(list.length>=20) break;
    if(!list.some(x=>x.cjProductId===p.cjProductId)) list.push(p);
  }

  if(list.length<20) throw new Error("CJ returned fewer than 20 sellable products.");
  catalogCache.list=list;
  catalogCache.expires=Date.now()+10*60*1000;
  return list;
}

async function resolveCart(input){
  if(!Array.isArray(input)||!input.length) throw new Error("Your cart is empty.");
  const ids=[...new Set(input.map(x=>String(x?.productId||"").replace(/^gringa-cj-/,"")).filter(Boolean))];
  const details=new Map(await Promise.all(ids.map(async pid=>[pid,await catalogDetail(pid)])));
  return input.map(x=>{
    const pid=String(x?.productId||"").replace(/^gringa-cj-/,"");
    const q=Number(x?.quantity);
    const p=details.get(pid);
    const v=p?.variants?.find(z=>z.vid===String(x?.variantId||""));
    if(!p) throw new Error("The selected product is no longer available.");
    if(!Number.isInteger(q)||q<1||q>10) throw new Error("Invalid quantity.");
    if(!v) throw new Error("The selected product variant is no longer available.");
    return {product:p,variant:v,quantity:q,unitPrice:v.price};
  });
}

async function stock(vid){
  const r=await cj("/product/stock/queryByVid",{query:{vid}});
  return Array.isArray(r.data)?r.data:[];
}

function origin(rows,dest){
  const a=rows
    .filter(x=>Number(x.totalInventoryNum??x.totalInventory??x.inventory??0)>0)
    .map(x=>String(x.countryCode||"").toUpperCase())
    .filter(Boolean);
  return a.includes(dest)?dest:a.includes("CN")?"CN":a[0]||"CN";
}

async function freight(from,to,zip,items){
  const r=await cj("/logistic/freightCalculate",{
    method:"POST",
    body:{
      startCountryCode:from,
      endCountryCode:to,
      zip,
      products:items.map(x=>({quantity:x.quantity,vid:x.variant.vid}))
    }
  });
  const a=Array.isArray(r.data)?r.data.filter(x=>x&&x.logisticName&&!x.error):[];
  if(!a.length) throw new Error("CJ returned no shipping method for this destination.");
  const safe=a.filter(x=>!String(x.message||"").toLowerCase().includes("not accept any disputes"));
  const b=safe.length?safe:a;
  b.sort((x,y)=>Number(x.totalPostageFee??x.logisticPrice??999999)-Number(y.totalPostageFee??y.logisticPrice??999999));
  const best=b[0];
  return {
    logisticName:String(best.logisticName),
    shippingCost:Number(best.totalPostageFee??best.logisticPrice??0),
    estimate:String(best.logisticAging||best.estimateDays||""),
    raw:best
  };
}

function shipping(o){
  const s=o?.purchase_units?.[0]?.shipping||{},a=s.address||{};
  const name=s.name?.full_name||o?.payer?.name?.given_name||"";
  const cc=clean(a.country_code,2).toUpperCase();
  if(!cc||!name||!a.address_line_1||!a.admin_area_2||!a.postal_code) throw new Error("PayPal did not return a complete shipping address.");
  return {
    name:clean(name,50),
    address:clean(a.address_line_1,500),
    address2:clean(a.address_line_2,500),
    city:clean(a.admin_area_2,50),
    province:clean(a.admin_area_1||a.admin_area_2,50),
    zip:clean(a.postal_code,20),
    countryCode:cc,
    phone:clean(o?.payer?.phone?.phone_number?.national_number,20),
    email:clean(o?.payer?.email_address,50)
  };
}

function quoteId(){
  return "Q"+Date.now().toString(36)+Math.random().toString(36).slice(2,8).toUpperCase();
}

function cleanAddress(a){
  const countryCode=clean(a?.countryCode,2).toUpperCase();
  const name=clean(a?.name,80);
  const address=clean(a?.address,500);
  const city=clean(a?.city,80);
  const province=clean(a?.province,80);
  const zip=clean(a?.zip,20);
  const phone=clean(a?.phone,30);
  if(!countryCode||countryCode.length!==2||!name||!address||!city||!province||!zip) {
    throw new Error("Complete the delivery address before checkout.");
  }
  return {countryCode,name,address,address2:clean(a?.address2,500),city,province,zip,phone,email:clean(a?.email,100)};
}

async function buildQuote(cartInput,addressInput){
  const items=await resolveCart(cartInput);
  const s=cleanAddress(addressInput);
  const stocks=await Promise.all(items.map(x=>stock(x.variant.vid)));
  const origins=stocks.map(x=>origin(x,s.countryCode));
  const from=origins.every(x=>x===origins[0])?origins[0]:"CN";
  const ship=await freight(from,s.countryCode,s.zip,items);
  const shippingPrice=shippingSalePrice(ship.shippingCost);
  const productSubtotal=items.reduce((sum,x)=>sum+x.unitPrice*x.quantity,0);
  const total=productSubtotal+shippingPrice;
  const variableFee=(total*PAYPAL_VARIABLE_RATE);
  const tax=(total*TAX_RATE);
  const fixed=PAYPAL_FIXED_FEE;
  const estimatedProfit=total-productSubtotal-ship.shippingCost-variableFee-tax-fixed;
  const quote={
    id:quoteId(),
    createdAt:Date.now(),
    expiresAt:Date.now()+15*60*1000,
    cart:cartInput,
    address:s,
    items:items.map(x=>({productId:x.product.cjProductId,variantId:x.variant.vid,quantity:x.quantity,unitPrice:x.unitPrice,cost:x.variant.cost})),
    from,
    shippingCost:ship.shippingCost,
    shippingPrice,
    logistics:ship.logisticName,
    estimate:ship.estimate,
    productSubtotal,
    total,
    estimatedPayPalFee:variableFee+fixed,
    estimatedTax:tax,
    estimatedProfit
  };
  quoteMemory.set(quote.id,quote);
  return quote;
}

function getQuote(id){
  const q=quoteMemory.get(String(id||""));
  if(!q||q.expiresAt<Date.now()) {
    if(q) quoteMemory.delete(String(id||""));
    throw new Error("The shipping quote expired. Please calculate shipping again.");
  }
  return q;
}

async function sendToCJ(paypalId,paypalOrder,items,s,quote){
  if(orderMemory.has(paypalId)) return orderMemory.get(paypalId);

  const from=quote.from;
  const ship={logisticName:quote.logistics,shippingCost:quote.shippingCost};
  const payload={
    orderNumber:"GRINGA-"+paypalId,
    shippingZip:s.zip,
    shippingCountryCode:s.countryCode,
    shippingCountry:s.countryCode,
    shippingProvince:s.province,
    shippingCity:s.city,
    shippingPhone:s.phone,
    shippingCustomerName:s.name,
    shippingAddress:s.address,
    shippingAddress2:s.address2,
    email:s.email,
    remark:"GRINGA / PayPal "+paypalId,
    shopAmount:paypalOrder.purchase_units?.[0]?.amount?.value||"",
    logisticName:ship.logisticName,
    fromCountryCode:from,
    platform:"Api",
    shopLogisticsType:2,
    orderFlow:1,
    payType:2,
    storeOrderTime:Math.floor(Date.now()/1000),
    products:items.map(x=>({
      vid:x.variant.vid,
      sku:x.variant.sku,
      storeProductId:x.product.id,
      storeProductImg:x.product.image,
      storeProductName:x.product.name,
      storeSku:"GRINGA-"+x.variant.sku,
      variantOptions:x.variant.name,
      quantity:x.quantity,
      unitPrice:x.variant.cost,
      storeLineItemId:paypalId+"-"+x.variant.vid
    }))
  };

  const r=await cj("/shopping/order/createOrderV3",{method:"POST",body:payload});
  const d=r.data||{};
  if(!d.orderId&&!d.shipmentOrderId) throw new Error("CJ did not return an order ID.");

  const o={
    paypalOrderId:paypalId,
    cjOrderId:d.orderId||null,
    cjOrderNumber:d.orderNumber||payload.orderNumber,
    shipmentOrderId:d.shipmentOrderId||null,
    shippingCost:Number(ship.shippingCost||0),
    logistics:ship.logisticName,
    origin:from
  };
  orderMemory.set(paypalId,o);
  return o;
}

app.get("/api/pricing",(req,res)=>res.json({
  ok:true,
  targetMargin:TARGET_MARGIN,
  minProfit:MIN_PROFIT,
  paypalVariableRate:PAYPAL_VARIABLE_RATE,
  paypalFixedFee:PAYPAL_FIXED_FEE,
  taxRate:TAX_RATE,
  currency:"USD"
}));

app.get("/api/health",(_q,res)=>res.json({
  ok:true,
  service:"gringa-store",
  paypal:Boolean(process.env.PAYPAL_CLIENT_ID),
  cj:Boolean(process.env.CJ_ACCESS_TOKEN)
}));

app.get("/api/cj/status",async(_q,res)=>{
  try{
    const p=await catalogDetail(CJ_PRODUCT_ID);
    res.json({ok:true,productId:p.cjProductId,variants:p.variants.length,price:p.price});
  }catch(e){
    res.status(503).json({ok:false,error:e.message});
  }
});

app.get("/api/catalog",async(_q,res)=>{
  try{
    const products=await catalogList();
    res.set("Cache-Control","public,max-age=300");
    res.json({ok:true,count:products.length,products});
  }catch(e){
    console.error(e);
    res.status(503).json({ok:false,error:"The live CJ collection is temporarily unavailable. Please try again shortly."});
  }
});

app.get("/api/catalog/:pid",async(req,res)=>{
  const pid=clean(req.params.pid,100).replace(/^gringa-cj-/,"");
  if(!pid) return res.status(400).json({ok:false,error:"Invalid product ID."});
  try{
    const p=await catalogDetail(pid);
    res.set("Cache-Control","public,max-age=300");
    res.json({ok:true,product:p});
  }catch(e){
    console.error(e);
    res.status(404).json({ok:false,error:"This product is temporarily unavailable."});
  }
});

app.get("/api/paypal/config",(_q,res)=>res.json({
  configured:Boolean(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET),
  clientId:process.env.PAYPAL_CLIENT_ID||null,
  environment:(process.env.PAYPAL_ENVIRONMENT||"live").toLowerCase()
}));

app.get("/api/paypal/status",async(_q,res)=>{
  try{
    await paypalToken();
    res.json({ok:true});
  }catch(e){
    res.status(503).json({ok:false,error:e.message});
  }
});

app.post("/api/quote",async(req,res)=>{
  try{
    const quote=await buildQuote(req.body?.cart,req.body?.address);
    res.json({
      ok:true,
      quoteId:quote.id,
      currency:"USD",
      productSubtotal:quote.productSubtotal,
      shippingCost:quote.shippingCost,
      shippingPrice:quote.shippingPrice,
      total:quote.total,
      logistics:quote.logistics,
      estimate:quote.estimate,
      estimatedProfit:quote.estimatedProfit,
      marginTarget:TARGET_MARGIN,
      minProfit:MIN_PROFIT
    });
  }catch(e){
    console.error(e);
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/paypal/create-order",async(req,res)=>{
  try{
    const q=getQuote(req.body?.quoteId);
    const items=await resolveCart(req.body?.cart);
    const total=Number(q.total).toFixed(2);
    const cartKey=JSON.stringify(items.map(x=>[x.product.cjProductId,x.variant.vid,x.quantity,x.unitPrice]));
    const quoteKey=JSON.stringify(q.items.map(x=>[x.productId,x.variantId,x.quantity,x.unitPrice]));
    if(cartKey!==quoteKey) throw new Error("The cart changed. Please calculate shipping again.");

    const d=await paypal("/v2/checkout/orders",{
      method:"POST",
      body:{
        intent:"CAPTURE",
        payment_source:{
          paypal:{
            experience_context:{
              brand_name:"GRINGA",
              landing_page:"LOGIN",
              user_action:"PAY_NOW",
              shipping_preference:"NO_SHIPPING",
              return_url:"https://gringa.onrender.com/",
              cancel_url:"https://gringa.onrender.com/"
            }
          }
        },
        purchase_units:[{
          reference_id:"GRINGA-"+q.id,
          custom_id:"GRINGA-"+q.id,
          description:"GRINGA purchase",
          amount:{
            currency_code:"USD",
            value:total,
            item_total:{currency_code:"USD",value:Number(q.productSubtotal).toFixed(2)},
            shipping:{currency_code:"USD",value:Number(q.shippingPrice).toFixed(2)}
          },
          items:items.map(x=>({
            name:x.product.name.slice(0,127),
            sku:x.variant.sku,
            quantity:String(x.quantity),
            image_url:x.product.image||undefined,
            url:"https://gringa.onrender.com/",
            unit_amount:{currency_code:"USD",value:x.unitPrice.toFixed(2)},
            category:"PHYSICAL_GOODS"
          }))
        }]
      }
    });
    res.json({id:d.id});
  }catch(e){
    console.error(e);
    res.status(400).json({error:e.message});
  }
});

app.post("/api/paypal/capture-order",async(req,res)=>{
  const id=clean(req.body?.orderId,30);
  if(!/^[A-Z0-9-]{10,30}$/i.test(id)) return res.status(400).json({error:"Invalid PayPal order ID."});
  try{
    const q=getQuote(req.body?.quoteId);
    const items=await resolveCart(req.body?.cart);
    const paidExpected=Number(q.total).toFixed(2);
    const cartKey=JSON.stringify(items.map(x=>[x.product.cjProductId,x.variant.vid,x.quantity,x.unitPrice]));
    const quoteKey=JSON.stringify(q.items.map(x=>[x.productId,x.variantId,x.quantity,x.unitPrice]));
    if(cartKey!==quoteKey) throw new Error("The cart changed. Please calculate shipping again.");

    let cap=await paypal("/v2/checkout/orders/"+encodeURIComponent(id)+"/capture",{method:"POST",body:{}});
    if(cap.status!=="COMPLETED") return res.status(202).json({ok:false,status:cap.status,orderId:id});
    const paid=Number(cap.purchase_units?.[0]?.amount?.value||0).toFixed(2);
    if(paid!==paidExpected) throw new Error("Payment amount does not match the store quote.");

    const o=await sendToCJ(id,cap,items,q.address,q);
    quoteMemory.delete(q.id);
    res.json({
      ok:true,
      status:"COMPLETED",
      orderId:id,
      captureId:cap.purchase_units?.[0]?.payments?.captures?.[0]?.id||null,
      cjOrderId:o.cjOrderId,
      cjOrderNumber:o.cjOrderNumber,
      shippingCost:o.shippingCost,
      logistics:o.logistics,
      deliveryEstimate:q.estimate
    });
  }catch(e){
    console.error("Fulfillment:",e);
    res.status(502).json({
      ok:false,
      paymentCaptured:true,
      orderId:id,
      error:"Payment was captured, but the CJ fulfillment step needs attention. Do not pay again."
    });
  }
});

app.get("/api/order/:id",(_q,res)=>{
  const o=orderMemory.get(clean(_q.params.id,30));
  if(!o) return res.status(404).json({error:"Order not found in this server session."});
  res.json({ok:true,order:o});
});

app.get("*splat",(_q,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log("Store running on port "+PORT));
