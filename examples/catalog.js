// Fictional content; no copyrighted art or host-specific currency. Asset URLs are optional.
export const sampleCatalog = {
  version:3,
  capabilities:{version:1,preset:'demo',primitives:{issuance:true,transfer:true,settlement:true}},
  features:{cardTrading:true,currencyTrading:true,conversion:true,tradeUps:true,publicAlbums:true},
  currencies:[
    {id:'credits',name:'Credits',value:{numerator:1,denominator:1},tradable:true},
    {id:'gems',name:'Gems',value:{numerator:100,denominator:1},tradable:true},
    {id:'stamps',name:'Stamps',value:{numerator:5,denominator:2},tradable:false}
  ],
  rarities:[{id:'common',name:'Common',rank:0},{id:'rare',name:'Rare',rank:1},{id:'unique',name:'Unique',rank:2}],
  lines:[{id:'sky',name:'Sky Atlas'},{id:'garden',name:'Pocket Garden'}],
  cards:[
    {id:'dawn',lineId:'sky',name:'Dawn',description:'The first light falls across a quiet mountain range.',tags:['landscape','morning'],stats:{light:8,altitude:2400},layers:[{id:'sky',src:'/demo/art/dawn.svg',depth:0},{id:'orb',src:'/demo/layers/orb.svg',depth:24,effect:'emissive'}],metadata:{'artist.credit':'Procedural demo composition'},appearance:{background:'linear-gradient(160deg,#e8bb80,#614c75,#223957)'}},
    {id:'cloud',lineId:'sky',name:'Cloud Study',tags:['landscape','weather'],stats:{light:5,altitude:3200},layers:[{id:'scene',src:'/demo/art/cloud.svg',depth:6}],metadata:{'atlas.weather':'Clear'},appearance:{background:'linear-gradient(160deg,#b2d1d9,#50798b,#253d60)'}},
    {id:'aurora',lineId:'sky',name:'Aurora',tags:['night','light'],stats:{light:9,altitude:1800},layers:[{id:'scene',src:'/demo/art/aurora.svg',depth:10}],metadata:{'atlas.weather':'Polar'},appearance:{background:'linear-gradient(160deg,#499e85,#394282,#14283b)'}},
    {id:'solstice',lineId:'sky',name:'One Solstice',tags:['sun','limited'],stats:{light:10,altitude:4000},layers:[{id:'scene',src:'/demo/art/solstice.svg',depth:8}],metadata:{'atlas.edition':'Unique'},appearance:{background:'linear-gradient(160deg,#f3d089,#ac7476,#283251)'}},
    {id:'fern',lineId:'garden',name:'Fern',tags:['botanical','green'],stats:{growth:8,resilience:7},layers:[{id:'scene',src:'/demo/art/fern.svg',depth:9}],metadata:{'botany.family':'Ferns'},appearance:{background:'linear-gradient(160deg,#8aab83,#456653,#17342e)'}},
    {id:'orchid',lineId:'garden',name:'Orchid',tags:['botanical','flower'],stats:{growth:4,resilience:5},layers:[{id:'scene',src:'/demo/art/orchid.svg',depth:12}],metadata:{'botany.family':'Orchids'},appearance:{background:'linear-gradient(160deg,#ddaab7,#956a8a,#364859)'}},
    ...['west','east'].map((side,index)=>({id:'horizon.'+side,lineId:'sky',name:side==='west'?'Horizon · West':'Horizon · East',tags:['panorama','landscape'],description:'One half of a shared horizon. Inspect both halves together and choose Assemble.',metadata:{'scene.name':'Shared Horizon','scene.piece':index+1},layers:[{id:'landscape',src:'/demo/art/horizon.svg',depth:0,crop:{x:index/2,y:0,width:.5,height:1}},{id:'orbit',src:'/demo/art/horizon-orbit.svg',depth:14,crop:{x:index/2,y:0,width:.5,height:1}}]}))
  ],
  variants:[
    {id:'dawn.standard',cardId:'dawn',rarityId:'common',finish:'gloss'},
    {id:'cloud.standard',cardId:'cloud',rarityId:'common',finish:'gloss'},
    {id:'aurora.holo',cardId:'aurora',rarityId:'rare',finish:'holo',supplyLimit:100},
    {id:'solstice.unique',cardId:'solstice',rarityId:'unique',finish:'foil',supplyLimit:1,
      bindings:{'demo.code':{visibility:'owner',transfer:'retain',factory:'demo.code',data:{}}}},
    {id:'fern.standard',cardId:'fern',rarityId:'common',finish:'standard'},
    {id:'orchid.foil',cardId:'orchid',rarityId:'rare',finish:'foil',supplyLimit:50},
    {id:'horizon.west.standard',cardId:'horizon.west',rarityId:'common',finish:'gloss'},
    {id:'horizon.east.standard',cardId:'horizon.east',rarityId:'common',finish:'gloss'}
  ],
  products:[
    {id:'sky.basic',lineId:'sky',name:'Sky · Discovery',revision:1,price:{currencyId:'credits',amount:100},
      duplicatePolicy:{scope:'pack',fallback:'allow'},slots:[{count:3,pool:[
        {variantId:'dawn.standard',weight:45},{variantId:'cloud.standard',weight:45},{variantId:'aurora.holo',weight:9},{variantId:'solstice.unique',weight:1}]}]},
    {id:'sky.premium',lineId:'sky',name:'Sky · Holo',revision:1,price:{currencyId:'gems',amount:3},
      slots:[{count:1,pool:[{variantId:'aurora.holo',weight:99},{variantId:'solstice.unique',weight:1}]}]},
    {id:'garden.basic',lineId:'garden',name:'Garden · Seedling',revision:1,price:{currencyId:'credits',amount:60},
      slots:[{count:2,pool:[{variantId:'fern.standard',weight:90},{variantId:'orchid.foil',weight:10}]}]},
    {id:'sky.horizon',lineId:'sky',name:'Sky · Shared Horizon',revision:1,price:{currencyId:'credits',amount:140},slots:[{count:1,pool:[{variantId:'horizon.west.standard',weight:1}]},{count:1,pool:[{variantId:'horizon.east.standard',weight:1}]}]},
    {id:'sky.night',lineId:'sky',name:'Sky · Nightfall',revision:1,price:{currencyId:'credits',amount:120},pity:{rarityId:'rare',after:6},slots:[{count:1,pool:[{variantId:'cloud.standard',weight:9},{variantId:'aurora.holo',weight:1}]}]}
  ],
  displayFields:[{id:'atlas.light',path:'stats.light',label:'Light',type:'number'},{id:'botany.growth',path:'stats.growth',label:'Growth',type:'number'}],
  combinations:[{id:'shared-horizon',name:'Shared Horizon',columns:2,rows:1,gap:0,pieces:[{cardId:'horizon.west',column:0,row:0},{cardId:'horizon.east',column:1,row:0}]}],
  recipes:[
    {id:'sky.upgrade',name:'Three common Sky duplicates → rare',lineId:'sky',inputRarityId:'common',
      inputCount:3,duplicatesOnly:true,outputPool:[{variantId:'aurora.holo',weight:1}]}
  ]
};
