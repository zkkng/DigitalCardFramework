import assert from 'node:assert/strict';
import {CardFramework} from '@digital-card/framework';
import {sampleCatalog} from './catalog.js';

// A trusted host may use the administration API without mounting the default panel.
const framework=new CardFramework({bindings:{'demo.code':()=>({code:'EXAMPLE-ONLY'})}});
const operator={role:'admin'};
try {
  framework.publishCatalog(operator,sampleCatalog);
  const collector=framework.registerUser(operator,{provider:'example',subject:'collector',displayName:'Example collector'});
  const overview=framework.adminOverview(operator);
  const product=overview.lines.flatMap(line=>line.products)[0];
  const saved=framework.configureAdmin(operator,{
    key:'example-discount',expectedRevision:overview.revision,
    scope:'product',targetId:product.id,changes:{discountPercent:10},
    reason:'Community launch discount'
  });
  const gift=framework.administerCards(operator,{
    key:'example-award',expectedRevision:saved.revision,userId:collector.id,
    action:'give',variantId:'dawn.standard',quantity:1,reason:'Community launch award'
  });
  assert.equal(framework.adminUser(operator,{userId:collector.id}).inventory.items.length,1);
  assert.equal(framework.adminHistory(operator).items.length,2);
  assert.equal(framework.audit(operator).ok,true);
  assert.equal(gift.revision,saved.revision+1);
  console.log('Public administration API: discount, card award, inventory and history verified.');
} finally {framework.close();}
