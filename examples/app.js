import {createClient} from '/src/client.js';
import {mountFramework} from '/src/ui.js';
import {renderTrading} from '/src/trading-ui.js';
import {renderCollection,renderAlbums} from '/src/collection-ui.js';
import {renderStudio} from '/src/studio-ui.js';
import {renderActivity} from '/src/player-ui.js';
const config=await (await fetch('/host/config')).json(),select=document.querySelector('#user'),client=createClient();
document.querySelector('.brand-name').textContent=config.brand;document.title=config.brand+' · Collect, discover, exchange';
const error=document.querySelector('#demo-error');let app;
async function mount(){app?.dispose();const me=await client.me();app=mountFramework(document.querySelector('#framework'),{client,navigation:'tabs',participants:config.users??[],
  sections:['shop','packs','collection','marketplace','rewards','codes','albums','trades','wallet','activity',...((me.role==='admin'||me.permissions?.includes('trading.manage'))?['tradingControls']:[]),...((me.role==='admin'||me.permissions?.includes('catalog.read'))?['studio']:[])],
  views:{trades:renderTrading,collection:renderCollection,albums:renderAlbums,studio:renderStudio,activity:renderActivity},viewLabels:{studio:'Creator studio',activity:'Activity & account'}});await app.ready;error.textContent='';}
async function login(){try{const response=await fetch('/demo/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:select.value})});if(!response.ok)throw new Error('Demo sign-in failed');localStorage.setItem('dc.demo.user',select.value);document.querySelector('#user-id').textContent=select.value===config.users[0].id?'Catalog operator · fictional account':'Collector · fictional account';await mount();}catch(err){error.textContent=err.message;}}
if(config.mode==='demo'){
  for(const user of config.users){const option=document.createElement('option');option.value=user.id;option.textContent=user.name;select.append(option);}const previous=localStorage.getItem('dc.demo.user');if(config.users.some(u=>u.id===previous))select.value=previous;
  document.querySelector('#sign-in').addEventListener('click',login);await login();
}else{
  document.querySelector('#demo-badge').textContent='COLLECTOR EDITION';document.querySelector('.demo-footer').textContent='Your collection. Your next discovery.';document.querySelector('#alternate-link').hidden=true;
  const account=document.querySelector('.account-box');account.replaceChildren();try{await mount();const logout=document.createElement('button');logout.textContent='Sign out';logout.addEventListener('click',async()=>{await fetch('/auth/logout',{method:'POST'});location.reload();});account.append(logout);}catch(err){if(err.status===401){const link=document.createElement('a');link.href=config.loginUrl;link.className='login-link';link.textContent='Sign in to collect';account.append(link);document.querySelector('#framework').textContent='Sign in to explore packs, collections, albums and trades.';}else error.textContent=err.message;}
}
