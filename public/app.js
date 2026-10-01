const products=[
 {name:"Magnetic Phone Mount",price:29.99,image:"https://images.unsplash.com/photo-1609592424865-8a4e1f8c0f2a?auto=format&fit=crop&w=800&q=80"},
 {name:"Portable LED Desk Lamp",price:34.99,image:"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80"},
 {name:"Ergonomic Laptop Stand",price:39.99,image:"https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=800&q=80"},
 {name:"Travel Organizer Set",price:24.99,image:"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80"},
 {name:"Wireless Charging Pad",price:27.99,image:"https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=800&q=80"},
 {name:"Reusable Water Bottle",price:22.99,image:"https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=800&q=80"}
];
let count=0;
const el=document.querySelector("#products");
el.innerHTML=products.map((p,i)=>`<article class="card"><img src="${p.image}" alt="${p.name}" loading="lazy"><div class="card-body"><h3>${p.name}</h3><div class="price">$ ${p.price.toFixed(2)}</div><button class="buy" data-i="${i}">Add to cart</button></div></article>`).join("");
document.addEventListener("click",e=>{if(e.target.matches(".buy")){count++;document.querySelector("#count").textContent=count;e.target.textContent="Added ✓";setTimeout(()=>e.target.textContent="Add to cart",900)}});