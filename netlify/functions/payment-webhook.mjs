import {json} from './_lib.mjs';
// Verify the provider signature here before changing an order to paid.
export default async event=>{if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});if(!process.env.PAYMENT_WEBHOOK_SECRET)return json(503,{error:'Webhook is not configured.'});const signature=event.headers['payment-signature']||event.headers['stripe-signature'];if(!signature)return json(400,{error:'Missing webhook signature.'});return json(501,{error:'Implement signature verification for PAYMENT_PROVIDER before enabling webhooks.'});};
