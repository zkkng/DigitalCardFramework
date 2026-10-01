// Fictional content; no copyrighted art or host-specific currency. Asset URLs are optional.
export const sampleCatalog = {
  version:2,
  features:{cardTrading:true,currencyTrading:true,conversion:true,tradeUps:true,publicAlbums:true},
  currencies:[
    {id:'credits',name:'Credits',value:{numerator:1,denominator:1},tradable:true},
    {id:'gems',name:'Gems',value:{numerator:100,denominator:1},tradable:true},
    {id:'stamps',name:'Stamps',value:{numerator:5,denominator:2},tradable:false}
  ],
  rarities:[{id:'common',name:'Common',rank:0},{id:'rare',name:'Rare',rank:1},{id:'unique',name:'Unique',rank:2}],
  lines:[{id:'sky',name:'Sky Atlas'},{id:'garden',name:'Pocket Garden'}],
  cards:[
    {id:'dawn',lineId:'sky',name:'Dawn',layers:[{id:'sky',src:'/demo/layers/sky.svg',depth:0},{id:'orb',src:'/demo/layers/orb.svg',depth:24,effect:'emissive'}],metadata:{'artist.credit':'Demo composition'},appearance:{background:'linear-gradient(160deg,#e8bb80,#614c75,#223957)'}},
    {id:'cloud',lineId:'sky',name:'Cloud Study',metadata:{'atlas.weather':'Clear'},appearance:{background:'linear-gradient(160deg,#b2d1d9,#50798b,#253d60)'}},
    {id:'aurora',lineId:'sky',name:'Aurora',metadata:{'atlas.weather':'Polar'},appearance:{background:'linear-gradient(160deg,#499e85,#394282,#14283b)'}},
    {id:'solstice',lineId:'sky',name:'One Solstice',metadata:{'atlas.edition':'Unique'},appearance:{background:'linear-gradient(160deg,#f3d089,#ac7476,#283251)'}},
    {id:'fern',lineId:'garden',name:'Fern',metadata:{'botany.family':'Ferns'},appearance:{background:'linear-gradient(160deg,#8aab83,#456653,#17342e)'}},
    {id:'orchid',lineId:'garden',name:'Orchid',metadata:{'botany.family':'Orchids'},appearance:{background:'linear-gradient(160deg,#ddaab7,#956a8a,#364859)'}}
  ],
  variants:[
    {id:'dawn.standard',cardId:'dawn',rarityId:'common',finish:'gloss'},
    {id:'cloud.standard',cardId:'cloud',rarityId:'common',finish:'gloss'},
    {id:'aurora.holo',cardId:'aurora',rarityId:'rare',finish:'holo',supplyLimit:100},
    {id:'solstice.unique',cardId:'solstice',rarityId:'unique',finish:'foil',supplyLimit:1,
      bindings:{'demo.code':{visibility:'owner',transfer:'retain',factory:'demo.code',data:{}}}},
    {id:'fern.standard',cardId:'fern',rarityId:'common',finish:'standard'},
    {id:'orchid.foil',cardId:'orchid',rarityId:'rare',finish:'foil',supplyLimit:50}
  ],
  products:[
    {id:'sky.basic',lineId:'sky',name:'Sky · Discovery',revision:1,price:{currencyId:'credits',amount:100},
      duplicatePolicy:{scope:'pack',fallback:'allow'},slots:[{count:3,pool:[
        {variantId:'dawn.standard',weight:45},{variantId:'cloud.standard',weight:45},{variantId:'aurora.holo',weight:9},{variantId:'solstice.unique',weight:1}]}]},
    {id:'sky.premium',lineId:'sky',name:'Sky · Holo',revision:1,price:{currencyId:'gems',amount:3},
      slots:[{count:1,pool:[{variantId:'aurora.holo',weight:99},{variantId:'solstice.unique',weight:1}]}]},
    {id:'garden.basic',lineId:'garden',name:'Garden · Seedling',revision:1,price:{currencyId:'credits',amount:60},
      slots:[{count:2,pool:[{variantId:'fern.standard',weight:90},{variantId:'orchid.foil',weight:10}]}]}
  ],
  recipes:[
    {id:'sky.upgrade',name:'Three common Sky duplicates → rare',lineId:'sky',inputRarityId:'common',
      inputCount:3,duplicatesOnly:true,outputPool:[{variantId:'aurora.holo',weight:1}]}
  ]
};
