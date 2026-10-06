import type {GroupLayer,TextLayer} from '../docs/complex-cards/contracts.js';
const group:GroupLayer={id:'finish',type:'group',isolate:true,width:1,height:1,blend:'screen',children:[{id:'image',type:'image',asset:'front'}],mask:{polygon:[[0,0],[1,0],[1,1]]},material:{kind:'foil'}};
const legacy:GroupLayer={id:'legacy',type:'group',children:[]};
// @ts-expect-error Isolated groups need explicit dimensions.
const unbounded:GroupLayer={id:'invalid',type:'group',isolate:true,children:[]};
// @ts-expect-error Nonisolated groups omit the isolate field.
const falseFlag:GroupLayer={id:'invalid',type:'group',isolate:false,children:[]};
// @ts-expect-error Isolation belongs to groups.
const text:TextLayer={id:'title',type:'text',text:'Title',width:1,height:.2,isolate:true};
void group;void legacy;void unbounded;void falseFlag;void text;

// @ts-expect-error Group clipping requires isolation.
const unisolatedMask:GroupLayer={id:'invalid',type:'group',children:[],mask:{asset:'mask'}};
void unisolatedMask;
