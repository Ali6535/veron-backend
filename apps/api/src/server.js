import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

const app=express();
app.use(cors());
app.use(express.json());
const orders=new Map();

app.get('/api/health',(_,res)=>res.json({ok:true,service:'VERON API'}));

app.post('/api/orders',(req,res)=>{
 const {items,customer,totalUsd}=req.body||{};
 if(!Array.isArray(items)||!customer||!totalUsd)return res.status(400).json({error:'Invalid order'});
 const id=`VERON-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
 const order={id,items,customer,totalUsd,status:'PENDING_PAYMENT',createdAt:new Date().toISOString()};
 orders.set(id,order); res.json(order);
});

app.post('/api/payments/nowpayments',async(req,res)=>{
 const {orderId}=req.body||{}, order=orders.get(orderId);
 if(!order)return res.status(404).json({error:'Order not found'});
 if(!process.env.NOWPAYMENTS_API_KEY)return res.status(503).json({error:'NOWPayments is not configured'});
 try{
  const r=await fetch('https://api.nowpayments.io/v1/payment',{
   method:'POST',headers:{'x-api-key':process.env.NOWPAYMENTS_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({
    price_amount:Number(order.totalUsd),price_currency:'usd',
    pay_currency:process.env.NOWPAYMENTS_PAY_CURRENCY||'usdttrc20',
    ipn_callback_url:`${process.env.APP_URL}/api/webhooks/nowpayments`,
    order_id:order.id,order_description:`VERON order ${order.id}`
   })
  });
  const data=await r.json();
  if(!r.ok)return res.status(r.status).json({error:'NOWPayments error',details:data});
  order.payment={provider:'NOWPayments',paymentId:data.payment_id,payAddress:data.pay_address,payAmount:data.pay_amount,payCurrency:data.pay_currency,status:data.payment_status||'waiting'};
  orders.set(order.id,order); res.json({orderId:order.id,payment:order.payment});
 }catch(e){res.status(500).json({error:'Payment creation failed'});}
});

app.post('/api/webhooks/nowpayments',(req,res)=>{
 const secret=process.env.NOWPAYMENTS_IPN_SECRET;
 if(!secret)return res.status(503).json({error:'IPN secret not configured'});
 const received=req.headers['x-nowpayments-sig'];
 const expected=crypto.createHmac('sha512',secret).update(JSON.stringify(req.body)).digest('hex');
 if(!received||received!==expected)return res.status(401).json({error:'Invalid webhook signature'});
 const {order_id,payment_status,payment_id}=req.body,order=orders.get(order_id);
 if(order){
  order.payment={...(order.payment||{}),paymentId:payment_id,status:payment_status};
  if(payment_status==='finished')order.status='PAID';
  if(['failed','expired'].includes(payment_status))order.status='PAYMENT_FAILED';
  orders.set(order.id,order);
 }
 res.json({received:true});
});

app.get('/api/orders/:id',(req,res)=>{
 const order=orders.get(req.params.id);
 if(!order)return res.status(404).json({error:'Not found'});
 res.json(order);
});
app.listen(process.env.PORT||4000,()=>console.log('VERON API running'));
