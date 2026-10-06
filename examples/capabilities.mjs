import {CardFramework} from '../src/core.js';
import {sampleCatalog} from './catalog.js';

const profiles={
  collection:{version:1},
  storefront:{version:1,preset:'storefront',primitives:{issuance:true,settlement:true}},
  packs:{version:1,preset:'packCollection',primitives:{issuance:true,settlement:true}},
  resale:{version:1,workflows:{resale:true},primitives:{transfer:true,settlement:true}},
};

// Each profile also works with a custom frontend using only the headless API.
for(const [name,capabilities] of Object.entries(profiles)){
  const framework=new CardFramework();
  try{
    const catalog=structuredClone(sampleCatalog);catalog.capabilities=capabilities;
    framework.publishCatalog({role:'admin'},catalog);
    const user=framework.registerUser({role:'admin'},{provider:'example',subject:name,displayName:'Example collector'});
    console.log(JSON.stringify({profile:name,...framework.capabilities({userId:user.id})}));
  }finally{framework.close();}
}
