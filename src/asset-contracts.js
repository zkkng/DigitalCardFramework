export function assetReference(value){
  if(typeof value!=='string'||!value.trim()||value.length>2000||/[\u0000-\u0020\\]/.test(value))return false;
  try{const url=new URL(value,'https://content.invalid/');return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
export function presentationLocation(value){
  if(typeof value!=='string'||value.length>2048)return false;
  try{const url=new URL(value,'https://local.invalid/');return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}
}
export function packDescription(value){return typeof value==='string'&&!!value.trim()&&value.length<=200;}
export const assetFormats={'dc-asset-reference':assetReference,'dc-presentation-location':presentationLocation,'dc-pack-description':packDescription};
