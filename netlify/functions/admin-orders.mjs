import {json,requireAdmin} from './_lib.mjs';
export default async event=>{if(!requireAdmin(event))return json(401,{error:'Unauthorized'});return json(200,{orders:[]});};
