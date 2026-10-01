const products=[];

let cart=[];
try {
  const saved=JSON.parse(localStorage.getItem("gringa-cart")||"[]");
  cart=Array.isArray(saved)?saved.filter(x=>x&&typeof x.id==="string"&&Number.isInteger(x.qty)&&x.qty>0):[];
} catch {
  localStorage.removeItem("gringa-cart");
  cart=[];
}

let paypalPromise=null;
const grid=document.querySelector("#grid"),count=document.querySelector("#count"),cartItems=document.querySelector("#cartItems"),subtotal=document.querySelector("#subtotal");
function money(n){return "$"+Number(n).toFixed(2)}

function renderProducts(filter="All"){
 const list=filter==="All"?products:products.filter(p=>p.cat===filter);
 if(!list.length){
   grid.innerHTML=`<div class="collection-note"><span>THE NEXT EDIT</span><h3>We’re curating the collection.</h3><p>Real products, real supplier information and real pricing will be added here after the GRINGA collection is selected from CJdropshipping.</p></div>`;
   return;
 }
 grid.innerHTML=list.map(p=>{const idx=products.indexOf(p);return `<article class="product"><div class="product-img"><img src="${p.img}" alt="${p.name}" loading="lazy"><span class="tag">${p.cat.toUpperCase()}</span></div><div class="product-info"><span class="cat">${p.cat}</span><h3>${p.name}</h3><p>${p.desc}</p><div class="product-bottom"><span class="price">${money(p.price)}</span><button type="button" class="add" data-add="${idx}">Add to bag</button></div></div></article>`}).join("");
}

function renderCart(){
 count.textContent=cart.reduce((a,x)=>a+x.qty,0);
 const total=cart.reduce((a,x)=>{
   const p=products.find(product=>product.id===x.id);
   return a+(p?p.price*x.qty:0);
 },0);
 subtotal.textContent=money(total);
 localStorage.setItem("gringa-cart",JSON.stringify(cart));
 if(!cart.length){
   cartItems.innerHTML='<div style="text-align:center;padding:60px 10px;color:#888">Your bag is empty.<br><br><a href="#shop" id="emptyShop">Explore the collection →</a></div>';
   document.querySelector("#checkout").disabled=true;
   document.querySelector("#paypalArea").hidden=true;
   document.querySelector("#checkout").hidden=false;
   return;
 }
 document.querySelector("#checkout").disabled=false;
 cartItems.innerHTML=cart.map((x,i)=>{
   const p=products.find(product=>product.id===x.id);
   return p?`<div class="cart-row"><img src="${p.img}" alt="${p.name}"><div><h4>${p.name}</h4><small>${x.qty} × ${money(p.price)}</small></div><button type="button" class="remove" data-remove="${i}">Remove</button></div>`:"";
 }).join("");
}

function cartPayload(){
 return cart.map(x=>({id:x.id,quantity:x.qty}));
}

async function loadPayPal(){
 if(paypalPromise) return paypalPromise;
 paypalPromise=(async()=>{
   const cfgResponse=await fetch("/api/paypal/config",{cache:"no-store"});
   const cfg=await cfgResponse.json().catch(()=>({}));
   if(!cfgResponse.ok || !cfg.configured || !cfg.clientId) throw new Error("PayPal is not configured on the store.");
   const statusResponse=await fetch("/api/paypal/status",{cache:"no-store"});
   const status=await statusResponse.json().catch(()=>({}));
   if(!statusResponse.ok || !status.ok) throw new Error(status.error||"PayPal checkout is temporarily unavailable.");
   if(cfg.environment!=="live") console.warn("PayPal environment:",cfg.environment);
   if(window.paypal) return;
   await new Promise((resolve,reject)=>{
     const script=document.createElement("script");
     script.src=`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=USD&intent=capture&commit=true&components=buttons`;
     script.async=true;
     script.onload=resolve;
     script.onerror=()=>reject(new Error("Could not load PayPal checkout."));
     document.head.appendChild(script);
   });
   if(!window.paypal || typeof window.paypal.Buttons!=="function") throw new Error("PayPal checkout loaded incorrectly.");
 })().catch(error=>{
   paypalPromise=null;
   throw error;
 });
 return paypalPromise;
}

async function openCheckout(){
 const area=document.querySelector("#paypalArea");
 const message=document.querySelector("#paypalMessage");
 const button=document.querySelector("#checkout");
 const container=document.querySelector("#paypal-button-container");
 if(!cart.length) return;

 button.disabled=true;
 button.textContent="Checking secure checkout…";
 area.hidden=false;
 message.className="paypal-message";
 message.textContent="Connecting securely to PayPal…";
 container.innerHTML="";

 try{
   await loadPayPal();
   if(!window.paypal || typeof window.paypal.Buttons!=="function") throw new Error("PayPal checkout is unavailable.");

   const paypalButtons=window.paypal.Buttons({
     style:{layout:"vertical",shape:"rect",label:"paypal",height:48},
     createOrder:async()=>{
       const response=await fetch("/api/paypal/create-order",{
         method:"POST",
         headers:{"Content-Type":"application/json"},
         body:JSON.stringify({cart:cartPayload()})
       });
       const data=await response.json().catch(()=>({}));
       if(!response.ok || !data.id) throw new Error(data.error||"Could not create the PayPal order.");
       return data.id;
     },
     onApprove:async(data)=>{
       message.className="paypal-message";
       message.textContent="Confirming your payment…";
       try{
         const response=await fetch("/api/paypal/capture-order",{
           method:"POST",
           headers:{"Content-Type":"application/json"},
           body:JSON.stringify({orderId:data.orderID})
         });
         const result=await response.json().catch(()=>({}));
         if(!response.ok || result.status!=="COMPLETED") throw new Error(result.error||"Payment was not completed.");

         cart=[];
         localStorage.removeItem("gringa-cart");
         renderCart();
         container.innerHTML="";
         area.hidden=false;
         button.hidden=true;
         message.className="paypal-message success";
         message.textContent="Payment successful! Your GRINGA order has been confirmed.";
       }catch(error){
         console.error("PayPal capture error:",error);
         message.className="paypal-message error";
         message.textContent=error.message||"We couldn't confirm the payment. Your bag is still saved.";
         button.hidden=false;
         button.disabled=false;
         button.textContent="Try secure checkout again →";
       }
     },
     onCancel:()=>{
       message.className="paypal-message";
       message.textContent="Checkout cancelled. Your bag is still saved.";
       button.hidden=false;
       button.disabled=false;
       button.textContent="Continue to secure checkout →";
     },
     onError:(err)=>{
       console.error("PayPal checkout error:",err);
       message.className="paypal-message error";
       message.textContent="PayPal could not open the payment window. Your bag is still saved. Please try again.";
       button.hidden=false;
       button.disabled=false;
       button.textContent="Try secure checkout again →";
     }
   });

   await paypalButtons.render("#paypal-button-container");
   button.hidden=true;
   message.className="paypal-message";
   message.textContent="Secure checkout ready.";
 }catch(error){
   console.error("Checkout initialization error:",error);
   container.innerHTML="";
   message.className="paypal-message error";
   message.textContent=error.message||"Unable to open secure checkout.";
   button.hidden=false;
   button.disabled=false;
   button.textContent="Try secure checkout again →";
 }
}

document.addEventListener("click",e=>{
 const add=e.target.closest("[data-add]");
 if(add){
   const p=products[+add.dataset.add];
   if(!p) return;
   const found=cart.find(x=>x.id===p.id);
   if(found) found.qty=Math.min(found.qty+1,50); else cart.push({...p,qty:1});
   renderCart();
   openCart();
   return;
 }
 const rem=e.target.closest("[data-remove]");
 if(rem){cart.splice(+rem.dataset.remove,1);renderCart();return}
 const filter=e.target.closest("[data-filter]");
 if(filter){
   e.preventDefault();
   const f=filter.dataset.filter;
   document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x.dataset.filter===f));
   renderProducts(f);
   document.querySelector("#products").scrollIntoView({behavior:"smooth"});
   return;
 }
 if(e.target.id==="emptyShop") closeCart();
});

function openCart(){
 document.querySelector("#drawer").classList.add("open");
 document.querySelector("#overlay").classList.add("open");
}
function closeCart(){
 document.querySelector("#drawer").classList.remove("open");
 document.querySelector("#overlay").classList.remove("open");
}
document.querySelector("#cartBtn").onclick=openCart;
document.querySelector("#closeCart").onclick=closeCart;
document.querySelector("#overlay").onclick=closeCart;
document.querySelector("#checkout").onclick=openCheckout;
renderProducts();
renderCart();
