const headers={'Content-Type':'application/json'};
export const json=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
export const bad=(message)=>json(400,{error:message});
export function read(event){try{return JSON.parse(event.body||'{}')}catch{return null}}
export function requireAdmin(event){const token=event.headers.authorization?.replace('Bearer ','');return Boolean(process.env.ADMIN_API_TOKEN&&token===process.env.ADMIN_API_TOKEN)}
export function clean(value,max=200){return typeof value==='string'?value.trim().replace(/[<>]/g,'').slice(0,max):''}
