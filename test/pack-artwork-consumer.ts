import {createClient} from '@digital-card/framework/client';
import type {Schemas} from '@digital-card/framework/wire-types';
const artwork:Schemas['PackArtwork']={front:'/front.png',back:'/back.png',reveal:'/reveal.png',alt:'Pack',design:{contract:'digital-card@0.1',digest:'sha256:'+'a'.repeat(64),baseURL:'/art/design/'}};
// @ts-expect-error Pinned designs use the supported presentation contract.
const bad:Schemas['PackArtwork']={design:{contract:'other',digest:'digest',baseURL:'/art/'}};
async function read(){const client=createClient(),packs=await client.packs();const front:string|undefined=packs[0]?.product.artwork?.front;const design:Schemas['PresentationReference']|undefined=packs[0]?.product.artwork?.design;const catalog=await client.catalog();const alt:string|undefined=catalog.products[0]?.artwork?.alt;void front;void design;void alt;}
void artwork;void bad;void read;
