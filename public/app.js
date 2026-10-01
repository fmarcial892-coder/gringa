let products=[];
let cart=[];
try{
  const s=JSON.parse(localStorage.getItem("gringa-cart")||"[]");
  cart=Array.isArray(s)?s.filter(x=>x&&typeof x.variantId==="string"&&Number.isInteger(x.qty)&&x.qty>0).map(x=>({...x,productId:String(x.productId||"").replace(/^gringa-cj-/,"")})):[];
}catch{
  localStorage.removeItem("gringa-cart");
}

const grid=document.querySelector("#grid");
const count=document.querySelector("#count");
const cartItems=document.querySelector("#cartItems");
const subtotal=document.querySelector("#subtotal");
const paypalArea=document.querySelector("#paypalArea");
const paypalMessage=document.querySelector("#paypalMessage");
const checkout=document.querySelector("#checkout");
const paypalContainer=document.querySelector("#paypal-button-container");
let paypalPromise=null;
let activeQuote=null;

function money(n){return "$"+Number(n).toFixed(2)}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function productId(p){return p.cjProductId||String(p.id||"").replace(/^gringa-cj-/,"")}

async function loadCatalog(){
  grid.innerHTML="<div class=\"collection-note\"><span>LIVE CJ CATALOG</span><h3>Loading the collection.</h3><p>Bringing in real products, images and current supplier information.</p></div>";
  const r=await fetch("/api/catalog",{cache:"no-store"});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok||!Array.isArray(d.products)||d.products.length<20) throw new Error(d.error||"The live collection is temporarily unavailable.");
  products=d.products;
  renderProducts();
  await hydrateCart();
  renderCart();
}

function renderProducts(){
  grid.innerHTML=products.map(p=>{
    const ready=Array.isArray(p.variants)&&p.variants.length;
    const picker=ready?variantPicker(p):"<div class=\"variant-box\" data-picker=\""+esc(productId(p))+"\" hidden></div>";
    return "<article class=\"product\" data-card=\""+esc(productId(p))+"\">"+
      "<div class=\"product-img\"><img src=\""+esc(p.image)+"\" alt=\""+esc(p.name)+"\" loading=\"lazy\"><span class=\"tag\">LIVE FROM CJ</span></div>"+
      "<div class=\"product-info\">"+
      "<span class=\"cat\">"+esc(p.category||"GRINGA EDIT")+"</span>"+
      "<h3>"+esc(p.name)+"</h3>"+
      "<p>"+esc(p.description||"Selected from our fulfillment partner.")+"</p>"+
      picker+
      "<div class=\"product-bottom\"><span class=\"price\">From "+money(p.price)+"</span>"+
      (ready
        ?"<button type=\"button\" class=\"add\" data-add=\""+esc(productId(p))+"\">Add to bag</button>"
        :"<button type=\"button\" class=\"add\" data-options=\""+esc(productId(p))+"\">Choose options →</button>")+
      "</div>"+
      "<small class=\"live-note\">Real CJ product · USD pricing · Secure checkout</small>"+
      "</div></article>";
  }).join("");
}

function variantPicker(p){
  const options=p.variants.map(v=>"<option value=\""+esc(v.vid)+"\">"+esc(v.name||v.sku)+"</option>").join("");
  return "<div class=\"variant-box\"><label>Select style / size</label><select data-variant=\""+esc(productId(p))+"\">"+options+"</select></div>";
}

async function loadProductDetail(pid){
  const r=await fetch("/api/catalog/"+encodeURIComponent(pid),{cache:"no-store"});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok||!d.product) throw new Error(d.error||"This product is temporarily unavailable.");
  const i=products.findIndex(p=>productId(p)===pid);
  if(i>=0) products[i]=d.product;
  return d.product;
}

async function hydrateCart(){
  const ids=[...new Set(cart.map(x=>x.productId))];
  for(const pid of ids){
    const p=products.find(x=>productId(x)===pid);
    if(p?.variants?.length) continue;
    try{await loadProductDetail(pid)}catch{
      cart=cart.filter(x=>x.productId!==pid);
    }
  }
}

function addProduct(pid){
  const p=products.find(x=>productId(x)===pid);
  if(!p||!p.variants?.length)return;
  const select=document.querySelector("[data-variant=\""+CSS.escape(pid)+"\"]");
  const vid=select?.value||p.variants[0].vid;
  const f=cart.find(x=>x.productId===pid&&x.variantId===vid);
  if(f)f.qty=Math.min(f.qty+1,10);
  else cart.push({productId:pid,variantId:vid,qty:1});
  renderCart();
  openCart();
}

function renderCart(){
  count.textContent=cart.reduce((a,x)=>a+x.qty,0);
  let total=0;
  cartItems.innerHTML=cart.map((x,i)=>{
    const p=products.find(z=>productId(z)===x.productId);
    const v=p?.variants?.find(z=>z.vid===x.variantId);
    if(!p||!v)return "";
    total+=(v?.price||p.price)*x.qty;
    return "<div class=\"cart-row\"><img src=\""+esc(v.image||p.image)+"\" alt=\""+esc(p.name)+"\"><div><h4>"+esc(p.name)+"</h4><small>"+esc(v.name||v.sku)+" · "+x.qty+" × "+money(v?.price||p.price)+"</small></div><button type=\"button\" class=\"remove\" data-remove=\""+i+"\">Remove</button></div>";
  }).join("");
  subtotal.textContent=money(total);
  localStorage.setItem("gringa-cart",JSON.stringify(cart));
  checkout.disabled=!cart.length;
  if(!cart.length){
    cartItems.innerHTML="<div style=\"text-align:center;padding:60px 10px;color:#888\">Your bag is empty.<br><br><a href=\"#products\" id=\"emptyShop\">Explore the collection →</a></div>";
    paypalArea.hidden=true;
  }
}

async function loadPayPal(){
  if(paypalPromise)return paypalPromise;
  paypalPromise=(async()=>{
    const cr=await fetch("/api/paypal/config",{cache:"no-store"});
    const c=await cr.json().catch(()=>({}));
    if(!cr.ok||!c.configured||!c.clientId) throw new Error("PayPal is not configured on the store.");
    if(window.paypal)return;
    await new Promise((resolve,reject)=>{
      const sc=document.createElement("script");
      sc.src="https://www.paypal.com/sdk/js?client-id="+encodeURIComponent(c.clientId)+"&currency=USD&intent=capture&commit=true&components=buttons";
      sc.async=true;
      sc.onload=resolve;
      sc.onerror=()=>reject(new Error("Could not load PayPal checkout."));
      document.head.appendChild(sc);
    });
    if(!window.paypal?.Buttons)throw new Error("PayPal checkout loaded incorrectly.");
  })().catch(e=>{paypalPromise=null;throw e});
  return paypalPromise;
}

function shippingForm(){
  return `
    <div class="shipping-form" id="shippingForm">
      <div class="shipping-title"><span>DELIVERY</span><strong>Where should we send it?</strong><small>CJ shipping is calculated from your destination before payment.</small></div>
      <div class="shipping-grid">
        <input id="shipName" placeholder="Full name" autocomplete="name">
        <input id="shipEmail" type="email" placeholder="Email" autocomplete="email">
        <input id="shipPhone" placeholder="Phone" autocomplete="tel">
        <select id="shipCountry">
          <option value="">Country</option>
          <option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option>
          <option value="AU">Australia</option><option value="DE">Germany</option><option value="FR">France</option>
          <option value="ES">Spain</option><option value="IT">Italy</option><option value="PT">Portugal</option>
          <option value="BR">Brazil</option><option value="MX">Mexico</option><option value="NL">Netherlands</option>
          <option value="BE">Belgium</option><option value="IE">Ireland</option><option value="NZ">New Zealand</option>
        </select>
        <input id="shipZip" placeholder="Postal / ZIP code" autocomplete="postal-code">
        <input id="shipProvince" placeholder="State / Province" autocomplete="address-level1">
        <input id="shipCity" placeholder="City" autocomplete="address-level2">
        <input id="shipAddress" class="full" placeholder="Street address" autocomplete="street-address">
        <input id="shipAddress2" class="full" placeholder="Apartment, suite, unit (optional)" autocomplete="address-line2">
      </div>
      <button type="button" class="quote-btn" id="quoteBtn">Calculate delivery & total →</button>
      <div class="quote-result" id="quoteResult"></div>
    </div>`;
}

function shippingValues(){
  return {
    name:document.querySelector("#shipName")?.value.trim(),
    email:document.querySelector("#shipEmail")?.value.trim(),
    phone:document.querySelector("#shipPhone")?.value.trim(),
    countryCode:document.querySelector("#shipCountry")?.value,
    zip:document.querySelector("#shipZip")?.value.trim(),
    province:document.querySelector("#shipProvince")?.value.trim(),
    city:document.querySelector("#shipCity")?.value.trim(),
    address:document.querySelector("#shipAddress")?.value.trim(),
    address2:document.querySelector("#shipAddress2")?.value.trim()
  };
}

async function calculateQuote(){
  const result=document.querySelector("#quoteResult"),btn=document.querySelector("#quoteBtn");
  btn.disabled=true; btn.textContent="Calculating real CJ delivery…";
  result.className="quote-result";
  result.textContent="Checking product cost, destination and available CJ shipping routes.";
  try{
    const r=await fetch("/api/quote",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({cart:cart.map(x=>({productId:x.productId,variantId:x.variantId,quantity:x.qty})),address:shippingValues()})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok)throw new Error(d.error||"CJ could not calculate delivery for this destination.");
    activeQuote=d;
    result.className="quote-result ready";
    result.innerHTML="<div><span>Products</span><strong>"+money(d.productSubtotal)+"</strong></div>"+
      "<div><span>Delivery</span><strong>"+money(d.shippingPrice)+"</strong></div>"+
      "<div class=\"quote-total\"><span>Total</span><strong>"+money(d.total)+"</strong></div>"+
      "<small>"+esc(d.logistics)+(d.estimate?" · estimated "+esc(d.estimate)+" days":"")+" · calculated from CJ</small>";
    subtotal.textContent=money(d.total);
    checkout.hidden=true;
    await renderPayPal(d.quoteId);
  }catch(e){
    activeQuote=null; result.className="quote-result error"; result.textContent=e.message||"Could not calculate delivery.";
    btn.disabled=false; btn.textContent="Calculate delivery & total →";
  }
}

async function renderPayPal(quoteId){
  paypalMessage.className="paypal-message"; paypalMessage.textContent="Preparing secure PayPal checkout…";
  paypalContainer.innerHTML="";
  await loadPayPal();
  const b=window.paypal.Buttons({
    style:{layout:"vertical",shape:"rect",label:"paypal",height:48},
    createOrder:async()=>{
      const r=await fetch("/api/paypal/create-order",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({quoteId,cart:cart.map(x=>({productId:x.productId,variantId:x.variantId,quantity:x.qty}))})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.id)throw new Error(d.error||"Could not create the PayPal order.");
      return d.id;
    },
    onApprove:async(data)=>{
      paypalMessage.textContent="Confirming payment and sending the order to CJ…";
      try{
        const r=await fetch("/api/paypal/capture-order",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({orderId:data.orderID,quoteId,cart:cart.map(x=>({productId:x.productId,variantId:x.variantId,quantity:x.qty}))})});
        const d=await r.json().catch(()=>({}));
        if(!r.ok){
          paypalMessage.className="paypal-message error";
          paypalMessage.textContent=d.error||"Payment was captured, but fulfillment needs attention. Do not pay again.";
          return;
        }
        cart=[]; activeQuote=null; localStorage.removeItem("gringa-cart"); renderCart(); paypalContainer.innerHTML="";
        paypalMessage.className="paypal-message success";
        paypalMessage.textContent="Payment successful. Your order has been sent to CJ for fulfillment.";
      }catch(e){
        paypalMessage.className="paypal-message error";
        paypalMessage.textContent=e.message||"We couldn't finish the order handoff. Do not pay again.";
      }
    },
    onCancel:()=>{paypalMessage.textContent="Checkout cancelled. Your bag and delivery quote are still saved.";},
    onError:e=>{console.error(e);paypalMessage.className="paypal-message error";paypalMessage.textContent="PayPal could not open the payment window. Your quote is still saved.";}
  });
  await b.render("#paypal-button-container");
  paypalMessage.textContent="Secure checkout ready.";
}

async function openCheckout(){
  if(!cart.length)return;
  checkout.disabled=true; checkout.textContent="Preparing delivery…"; paypalArea.hidden=false;
  paypalMessage.className="paypal-message"; paypalMessage.textContent="Enter your delivery details first.";
  paypalContainer.innerHTML=""; activeQuote=null;
  if(!document.querySelector("#shippingForm")){
    const holder=document.createElement("div"); holder.innerHTML=shippingForm(); paypalArea.prepend(holder.firstElementChild);
    document.querySelector("#quoteBtn").addEventListener("click",calculateQuote);
  }
  checkout.hidden=true;
  document.querySelector("#shippingForm").scrollIntoView({behavior:"smooth",block:"nearest"});
  checkout.disabled=false; checkout.textContent="Continue to secure checkout →";
}

document.addEventListener("click",async e=>{
  const remove=e.target.closest("[data-remove]");
  if(remove){cart.splice(Number(remove.dataset.remove),1);renderCart();return}

  const options=e.target.closest("[data-options]");
  if(options){
    const pid=options.dataset.options;
    options.disabled=true;
    options.textContent="Loading options…";
    try{
      const p=await loadProductDetail(pid);
      const card=document.querySelector("[data-card=\""+CSS.escape(pid)+"\"]");
      if(card) card.outerHTML=renderProductCard(p);
    }catch(err){
      options.disabled=false;
      options.textContent="Choose options →";
      alert(err.message||"Product options are temporarily unavailable.");
    }
    return;
  }

  const add=e.target.closest("[data-add]");
  if(add){addProduct(add.dataset.add);return}
  if(e.target.id==="emptyShop")closeCart();
});

function renderProductCard(p){
  const pid=productId(p);
  return "<article class=\"product\" data-card=\""+esc(pid)+"\">"+
    "<div class=\"product-img\"><img src=\""+esc(p.image)+"\" alt=\""+esc(p.name)+"\" loading=\"lazy\"><span class=\"tag\">LIVE FROM CJ</span></div>"+
    "<div class=\"product-info\"><span class=\"cat\">"+esc(p.category||"GRINGA EDIT")+"</span>"+
    "<h3>"+esc(p.name)+"</h3><p>"+esc(p.description||"Selected from our fulfillment partner.")+"</p>"+
    variantPicker(p)+
    "<div class=\"product-bottom\"><span class=\"price\">"+money(p.price)+"</span><button type=\"button\" class=\"add\" data-add=\""+esc(pid)+"\">Add to bag</button></div>"+
    "<small class=\"live-note\">Real CJ product · USD pricing · Secure checkout</small></div></article>";
}

function openCart(){document.querySelector("#drawer").classList.add("open");document.querySelector("#overlay").classList.add("open")}
function closeCart(){document.querySelector("#drawer").classList.remove("open");document.querySelector("#overlay").classList.remove("open")}

document.querySelector("#cartBtn").onclick=openCart;
document.querySelector("#closeCart").onclick=closeCart;
document.querySelector("#overlay").onclick=closeCart;
document.querySelector("#checkout").onclick=openCheckout;

loadCatalog().catch(e=>{
  console.error(e);
  grid.innerHTML="<div class=\"collection-note\"><span>COLLECTION ERROR</span><h3>We could not load the live collection.</h3><p>"+esc(e.message)+"</p><button class=\"primary retry-catalog\" type=\"button\">Try again</button></div>";
  document.querySelector(".retry-catalog")?.addEventListener("click",()=>loadCatalog().catch(()=>{}));
});
