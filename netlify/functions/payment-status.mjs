import {json,clean} from './_lib.mjs';
export default async event=>{const id=clean(event.queryStringParameters?.orderId||'',80);if(!id)return json(400,{error:'orderId is required'});return json(404,{error:'Order not found'});};
