const products=[
{id:"magnetic-phone-mount",name:"Magnetic Phone Mount",price:29.99,cat:"Tech",desc:"A clean, compact mount for your desk or daily setup.",img:"https://images.unsplash.com/photo-1556656793-08538906a9f8?auto=format&fit=crop&w=900&q=85"},
{id:"wireless-charging-pad",name:"Wireless Charging Pad",price:32.99,cat:"Tech",desc:"Minimal wireless charging for a clutter-free workspace.",img:"https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=900&q=85"},
{id:"ergonomic-laptop-stand",name:"Ergonomic Laptop Stand",price:44.99,cat:"Tech",desc:"Lift your screen and create a more comfortable setup.",img:"https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=900&q=85"},
{id:"portable-led-desk-lamp",name:"Portable LED Desk Lamp",price:36.99,cat:"Home",desc:"Soft, modern light for work, reading and late nights.",img:"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85"},
{id:"minimal-desk-organizer",name:"Minimal Desk Organizer",price:27.99,cat:"Home",desc:"Keep everyday essentials organized without the visual clutter.",img:"https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=900&q=85"},
{id:"reusable-water-bottle",name:"Reusable Water Bottle",price:24.99,cat:"Home",desc:"A simple everyday bottle designed for life on the move.",img:"https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=85"},
{id:"travel-organizer-set",name:"Travel Organizer Set",price:29.99,cat:"Travel",desc:"Keep cables, chargers and small essentials in their place.",img:"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85"},
{id:"travel-neck-pillow",name:"Travel Neck Pillow",price:26.99,cat:"Travel",desc:"Comfort-focused support for long flights and road trips.",img:"https://images.unsplash.com/photo-1563298723-dcfebaa392e3?auto=format&fit=crop&w=900&q=85"},
{id:"compact-travel-pouch",name:"Compact Travel Pouch",price:21.99,cat:"Travel",desc:"A neat carry-all for the little things you never want to lose.",img:"https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85"},
{id:"portable-mini-fan",name:"Portable Mini Fan",price:31.99,cat:"Tech",desc:"Compact personal airflow for your desk, travel or commute.",img:"https://images.unsplash.com/photo-1593642532744-d377ab507dc8?auto=format&fit=crop&w=900&q=85"},
{id:"airtight-storage-set",name:"Airtight Storage Set",price:39.99,cat:"Home",desc:"Clean storage that keeps everyday ingredients fresh.",img:"https://images.unsplash.com/photo-1584473457493-17c4c24290c1?auto=format&fit=crop&w=900&q=85"},
{id:"foldable-shopping-bag",name:"Foldable Shopping Bag",price:19.99,cat:"Travel",desc:"Lightweight reusable carry bag that folds down small.",img:"https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=900&q=85"}
];

let cart=JSON.parse(localStorage.getItem("gringa-cart")||"[]");
let paypalPromise=null;
const grid=document.querySelector("#grid"),count=document.querySelector("#count"),cartItems=document.querySelector("#cartItems"),subtotal=document.querySelector("#subtotal");
function money(n){return "$"+n.toFixed(2)}

function renderProducts(filter="All"){
 const list=filter==="All"?products:products.filter(p=>p.cat===filter);
 grid.innerHTML=list.map(p=>{const idx=products.indexOf(p);return `<article class="product"><div class="product-img"><img src="${p.img}" alt="${p.name}" loading="lazy"><span class="tag">${p.cat.toUpperCase()}</span></div><div class="product-info"><span class="cat">${p.cat}</span><h3>${p.name}</h3><p>${p.desc}</p><div class="product-bottom"><span class="price">${money(p.price)}</span><button class="add" data-add="${idx}">Add to bag</button></div></div></article>`}).join("");
}

function renderCart(){
 count.textContent=cart.reduce((a,x)=>a+x.qty,0);
 const total=cart.reduce((a,x)=>a+x.price*x.qty,0);
 subtotal.textContent=money(total);
 if(!cart.length){
   cartItems.innerHTML='<div style="text-align:center;padding:60px 10px;color:#888">Your bag is empty.<br><br><a href="#shop" id="emptyShop">Explore the collection →</a></div>';
   document.querySelector("#checkout").disabled=true;
   return;
 }
 document.querySelector("#checkout").disabled=false;
 cartItems.innerHTML=cart.map((x,i)=>`<div class="cart-row"><img src="${x.img}" alt=""><div><h4>${x.name}</h4><small>${x.qty} × ${money(x.price)}</small></div><button class="remove" data-remove="${i}">Remove</button></div>`).join("");
 localStorage.setItem("gringa-cart",JSON.stringify(cart));
}

function cartPayload(){
 return cart.map(x=>({id:x.id,quantity:x.qty}));
}

async function loadPayPal(){
 if(paypalPromise) return paypalPromise;
 paypalPromise=(async()=>{
   const cfg=await fetch("/api/paypal/config").then(r=>r.json());
   if(!cfg.configured || !cfg.clientId) throw new Error("PayPal is not configured on the store.");
   if(cfg.environment!=="live") console.warn("PayPal environment:",cfg.environment);
   if(window.paypal) return;
   await new Promise((resolve,reject)=>{
     const script=document.createElement("script");
     script.src=`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=USD&intent=capture&components=buttons`;
     script.onload=resolve;
     script.onerror=()=>reject(new Error("Could not load PayPal checkout."));
     document.head.appendChild(script);
   });
 })();
 return paypalPromise;
}

async function openCheckout(){
 const area=document.querySelector("#paypalArea");
 const message=document.querySelector("#paypalMessage");
 const button=document.querySelector("#checkout");
 if(!cart.length) return;
 button.disabled=true;
 button.textContent="Loading secure checkout…";
 area.hidden=false;
 message.textContent="";
 try{
   await loadPayPal();
   const container=document.querySelector("#paypal-button-container");
   container.innerHTML="";
   window.paypal.Buttons({
     style:{layout:"vertical",shape:"rect",label:"paypal",height:48},
     createOrder:async()=>{
       const response=await fetch("/api/paypal/create-order",{
         method:"POST",
         headers:{"Content-Type":"application/json"},
         body:JSON.stringify({cart:cartPayload()})
       });
       const data=await response.json();
       if(!response.ok) throw new Error(data.error||"Could not create the PayPal order.");
       return data.id;
     },
     onApprove:async(data)=>{
       message.textContent="Confirming your payment…";
       const response=await fetch("/api/paypal/capture-order",{
         method:"POST",
         headers:{"Content-Type":"application/json"},
         body:JSON.stringify({orderId:data.orderID})
       });
       const result=await response.json();
       if(!response.ok || result.status!=="COMPLETED"){
         throw new Error(result.error||"Payment was not completed.");
       }
       cart=[];
       localStorage.removeItem("gringa-cart");
       renderCart();
       container.innerHTML="";
       button.hidden=true;
       message.className="paypal-message success";
       message.textContent="Payment successful! Your GRINGA order has been confirmed.";
     },
     onCancel:()=>{message.textContent="Checkout cancelled. Your bag is still saved.";},
     onError:(err)=>{
       console.error(err);
       message.className="paypal-message error";
       message.textContent="We couldn't complete the payment. Please try again.";
     }
   }).render("#paypal-button-container");
   button.hidden=true;
 }catch(error){
   console.error(error);
   message.className="paypal-message error";
   message.textContent=error.message||"Unable to open secure checkout.";
   button.disabled=false;
   button.textContent="Try secure checkout again →";
 }
}

document.addEventListener("click",e=>{
 const add=e.target.closest("[data-add]");
 if(add){
   const p=products[+add.dataset.add],found=cart.find(x=>x.id===p.id);
   if(found) found.qty++; else cart.push({...p,qty:1});
   renderCart();openCart();return;
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
