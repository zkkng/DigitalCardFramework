import {validatePresentationReference} from './presentation/integration.js';
const colors=new Set(['transparent','black','white','red','green','blue','gray','grey','yellow','orange','purple','pink','brown','navy','teal']);
const dimensions={padding:100,radius:100,borderWidth:12};
const legacyNames={'background':'background','background-color':'background','color':'color','border-color':'borderColor','padding':'padding','border-radius':'radius','border-width':'borderWidth'};
function color(value){
  if(typeof value!=='string'||value.length>80)return undefined;
  const text=value.trim().toLowerCase();
  if(colors.has(text)||/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text))return text;
  const match=/^(rgb|rgba)\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0(?:\.[0-9]{1,3})?|1(?:\.0{1,3})?))?\s*\)$/.exec(text);
  if(!match||[match[2],match[3],match[4]].some(n=>Number(n)>255)||(match[1]==='rgba')!==Boolean(match[5]))return undefined;
  return text;
}
function clean(input){
  const output={};if(!input||typeof input!=='object'||Array.isArray(input))return output;
  for(const key of ['background','color','borderColor']){const value=color(input[key]);if(value!==undefined)output[key]=value;}
  for(const [key,max]of Object.entries(dimensions)){const value=input[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max)output[key]=value;}
  return output;
}
/** Read historical appearance without interpreting arbitrary CSS as a stylesheet. */
export function albumAppearance(layout={}){
  const legacy={};if(!layout||typeof layout!=='object'||Array.isArray(layout))return {};
  if(typeof layout.css==='string'&&layout.css.length<=10000){
    const source=layout.css.replace(/\/\*[\s\S]*?\*\//g,'');
    for(const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      if(match[1].trim()!=='.dc-album')continue;
      for(const declaration of match[2].split(';')){
        const split=declaration.indexOf(':');if(split<0)continue;
        const key=legacyNames[declaration.slice(0,split).trim().toLowerCase()];if(!key)continue;
        let value=declaration.slice(split+1).trim();
        if(Object.hasOwn(dimensions,key)){if(!/^(?:[0-9]+(?:\.[0-9]+)?)(?:px)?$/.test(value))continue;value=Number(value.replace(/px$/,''));}
        legacy[key]=value;
      }
    }
  }
  return {...clean(legacy),...clean(layout.appearance)};
}
export function validateAlbumAppearance(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Album appearance must be an object');
  const result=clean(input);
  for(const key of Object.keys(input)){
    if(!['background','color','borderColor',...Object.keys(dimensions)].includes(key))throw new Error('Unknown album appearance field: '+key);
    if(!Object.hasOwn(result,key))throw new Error('Invalid album appearance value: '+key);
  }
  return result;
}
export function applyAlbumAppearance(node,appearance){
  const properties={background:'background-color',color:'color',borderColor:'border-color',padding:'padding',radius:'border-radius',borderWidth:'border-width'};
  for(const [name,value]of Object.entries(clean(appearance)))node.style.setProperty(properties[name],Object.hasOwn(dimensions,name)?value+'px':value);
  if(clean(appearance).borderWidth>0)node.style.setProperty('border-style','solid');
}
export function validateAlbumPageSize(value){
  if(!Number.isInteger(value)||value<1||value>100)throw new Error('Album page size must be an integer from 1 to 100');
  return value;
}
export function validateAlbumArtwork(input){
  const object=(value,allowed,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new Error('Invalid '+label);};
  const text=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('Invalid '+label);return value;};
  const image=(value,page=false)=>{
    object(value,page?['id','title','src','alt','design']:['src','alt','design'],'album image');
    const output={};
    if(!page||value.src!==undefined){
      const src=text(value.src,2000,'album image URL');let url;
      try{url=new URL(src,'https://assets.invalid/');}catch{throw new Error('Invalid album image URL');}
      if(/[\u0000-\u0020\\]/.test(src)||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid album image URL');
      output.src=src;
    }
    if(value.alt!==undefined)output.alt=text(value.alt,200,'album image description');
    if(value.design!==undefined)output.design={...validatePresentationReference(value.design)};
    if(page){output.id=text(value.id,100,'album page ID');if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(output.id))throw new Error('Invalid album page ID');if(value.title!==undefined)output.title=text(value.title,100,'album page title');}
    return output;
  };
  object(input,['cover','spine','pages'],'album artwork');const result={};
  for(const key of ['cover','spine'])if(input[key]!==undefined)result[key]=image(input[key]);
  if(input.pages!==undefined){
    if(!Array.isArray(input.pages)||input.pages.length>100)throw new Error('Album supports at most 100 artwork pages');
    result.pages=input.pages.map(page=>image(page,true));
    if(new Set(result.pages.map(page=>page.id)).size!==result.pages.length)throw new Error('Album page IDs must be unique');
  }
  return result;
}
export function albumArtwork(layout={}){
  try{return validateAlbumArtwork(layout.artwork??{});}catch{return {};}
}
export function validateAlbumPageAssignments(layout,placements){
  if(layout.artwork===undefined&&layout.pageSize===undefined)return;
  const ids=new Set((layout.artwork?.pages??[]).map(page=>page.id));
  for(const placement of placements){const pageId=placement.data?.pageId;if(pageId!==undefined&&pageId!==null&&(typeof pageId!=='string'||!ids.has(pageId)))throw new Error('Album card references an unknown page; choose an existing page or explicit automatic order');}
}
