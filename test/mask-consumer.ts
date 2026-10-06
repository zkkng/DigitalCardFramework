import type {PersistedMask,Material,TextLayer} from '../docs/complex-cards/contracts.js';
const crop:PersistedMask={asset:'atlas',rect:[0,0,128,128],transform:{scaleX:2,pivotX:.5}};
const polygon:PersistedMask={polygon:[[0,0],[1,0],[1,1]],invert:true};
const material:Material={kind:'foil',mask:crop};
const layer:TextLayer={id:'title',type:'text',text:'Title',width:1,height:.2,mask:polygon,material};
// @ts-expect-error Image and polygon sources are mutually exclusive.
const both:PersistedMask={asset:'atlas',polygon:[[0,0],[1,0],[1,1]]};
// @ts-expect-error Crops apply only to image sources.
const polygonCrop:PersistedMask={polygon:[[0,0],[1,0],[1,1]],rect:[0,0,128,128]};
// @ts-expect-error Structured and legacy material masks are mutually exclusive.
const doubleMask:Material={kind:'foil',mask:crop,maskAsset:'legacy'};
void layer;void both;void polygonCrop;void doubleMask;
