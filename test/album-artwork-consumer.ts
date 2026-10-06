import {createClient} from '@digital-card/framework/client';
import type {Schemas} from '@digital-card/framework/wire-types';
const artwork:Schemas['AlbumArtwork']={cover:{src:'/cover.png',alt:'Cover'},spine:{src:'/spine.png'},pages:[{id:'page-1',title:'First page'},{id:'page-2',src:'/page.png'}]};
const layout:Schemas['AlbumLayout']={pageSize:9,artwork,customLayout:{spacing:2}};
const automatic:Schemas['AlbumPageAssignment']={pageId:null,custom:true};
const client=createClient();
async function album(){const saved=await client.saveAlbum({key:'album-save',name:'Collection',layout,placements:[{copyId:'copy',data:{pageId:'page-1',custom:true}}]});const id:string=saved.id;const title:string|undefined=saved.layout.artwork?.pages?.[0]?.title;const view=await client.viewAlbum(id);const copyId:string|undefined=view.cards[0]?.copy.id;void title;void copyId;}
// @ts-expect-error Album image sources are required.
const missing:Schemas['AlbumImage']={alt:'Cover'};
// @ts-expect-error Artwork fields are explicitly defined.
const extra:Schemas['AlbumArtwork']={background:'/other.png'};
// @ts-expect-error Album page IDs are required.
const page:Schemas['AlbumPage']={src:'/page.png'};
void album;void missing;void extra;void page;void automatic;
