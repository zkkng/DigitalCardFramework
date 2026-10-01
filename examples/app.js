import {createClient} from '/src/client.js';
import {mountFramework} from '/src/ui.js';
const users=await (await fetch('/demo/users')).json(),select=document.querySelector('#user');
for(const user of users){const option=document.createElement('option');option.value=user.id;option.textContent=user.name;select.append(option);}
let app;
async function login() {
  try {
    await fetch('/demo/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:select.value})});
    app?.dispose();document.querySelector('#user-id').textContent='User ID: '+select.value;
    app=mountFramework(document.querySelector('#framework'),{client:createClient()});await app.ready;
    document.querySelector('#demo-error').textContent='';
  }catch(error){document.querySelector('#demo-error').textContent=error.message;}
}
document.querySelector('#sign-in').addEventListener('click',login);
await login();
