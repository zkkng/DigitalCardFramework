import {ensure} from './data.js';

export const editorContributionProtocol='digital-card-editor-contribution@1';
const name={type:'string',minLength:2,maxLength:100,pattern:'^[a-z][a-z0-9.-]+(?![\\s\\S])'};
const number={type:'number',minimum:-1000000,maximum:1000000};
export const editorContributionSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'https://digital-card.invalid/editor-contribution/v1',
  type:'object',additionalProperties:false,
  required:['protocol','id','version','title','controls'],
  properties:{protocol:{const:editorContributionProtocol},id:name,version:{type:'string',maxLength:32,pattern:'^[0-9]+\\.[0-9]+\\.[0-9]+(?![\\s\\S])'},title:{type:'string',minLength:1,maxLength:100},controls:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['id','label','field','minimum','maximum','step'],properties:{id:name,label:{type:'string',minLength:1,maxLength:160},field:{enum:['x','y','rotation']},minimum:number,maximum:number,step:{type:'number',exclusiveMinimum:0,maximum:1000000}}}}},
};
const fail=(condition,message='Invalid editor contribution')=>ensure(condition,'EDITOR_CONTRIBUTION',message);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const validName=value=>typeof value==='string'&&value.length>=2&&value.length<=100&&/^[a-z][a-z0-9.-]+(?![\s\S])/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1000000;
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value)&&value.isWellFormed();
function boundedJSON(value){
  let nodes=0;const seen=new Set();
  function visit(row,depth){
    fail(++nodes<=256&&depth<=4);
    if(row===null||typeof row==='boolean')return;
    if(typeof row==='number'){fail(Number.isFinite(row));return;}
    if(typeof row==='string'){fail(row.isWellFormed());return;}
    fail(Array.isArray(row)||plain(row));fail(!seen.has(row));seen.add(row);
    for(const key of Reflect.ownKeys(row)){
      if(Array.isArray(row)&&key==='length')continue;
      const descriptor=Object.getOwnPropertyDescriptor(row,key);
      fail(typeof key==='string'&&!['__proto__','constructor','prototype'].includes(key)&&descriptor.enumerable&&Object.hasOwn(descriptor,'value'));
      if(Array.isArray(row))fail(/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<row.length);
      visit(descriptor.value,depth+1);
    }
    seen.delete(row);
  }
  visit(value,0);fail(new TextEncoder().encode(JSON.stringify(value)).length<=16384);
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function validateEditorContribution(value){
  boundedJSON(value);
  fail(exact(value,['protocol','id','version','title','controls'])&&value.protocol===editorContributionProtocol&&validName(value.id)&&text(value.title,100)&&typeof value.version==='string'&&value.version.length<=32&&/^\d+\.\d+\.\d+(?![\s\S])/.test(value.version)&&Array.isArray(value.controls)&&value.controls.length>=1&&value.controls.length<=8);
  const ids=new Set(),fields=new Set();
  for(const control of value.controls){
    fail(exact(control,['id','label','field','minimum','maximum','step'])&&validName(control.id)&&text(control.label,160)&&['x','y','rotation'].includes(control.field)&&finite(control.minimum)&&finite(control.maximum)&&control.minimum<control.maximum&&finite(control.step)&&control.step>0&&!ids.has(control.id)&&!fields.has(control.field));
    ids.add(control.id);fields.add(control.field);
  }
  return freeze(structuredClone(value));
}
const defaults={x:{minimum:-1000000,maximum:1000000},y:{minimum:-1000000,maximum:1000000},rotation:{minimum:-360,maximum:360}};
/** Declarative panels are host-installed data; they receive no project object or executable authority. */
export function createEditorContributions(manifests=[],{grants=defaults}={}){
  fail(Array.isArray(manifests)&&manifests.length<=16);
  boundedJSON(grants);fail(plain(grants));
  for(const [field,bounds]of Object.entries(grants))fail(['x','y','rotation'].includes(field)&&exact(bounds,['minimum','maximum'])&&finite(bounds.minimum)&&finite(bounds.maximum)&&bounds.minimum<bounds.maximum,'Invalid editor contribution grants');
  const contributions=Object.freeze(manifests.map(validateEditorContribution)),enabled=new Map(),mounts=new Set();
  fail(new Set(contributions.map(panel=>panel.id)).size===contributions.length,'Duplicate editor contribution');
  const allowed=freeze(structuredClone(grants));let disposed=false;
  for(const panel of contributions)enabled.set(panel.id,true);
  function mount({root,getSelection,edit,run=fn=>Promise.resolve().then(fn),report=()=>{}}){
    fail(!disposed,'Editor contributions are disposed');
    const container=root.ownerDocument.createElement('section'),captured=getSelection();let closed=false,renderGeneration=0,controlEvents=new AbortController();
    container.className='dcs-editor-contributions';root.append(container);
    const current=()=>{const value=getSelection();return !disposed&&!closed&&value?.project===captured?.project&&value?.side===captured?.side&&value?.node===captured?.node;};
    function render(){
      const generation=++renderGeneration;
      controlEvents.abort();controlEvents=new AbortController();
      container.replaceChildren();
      if(!captured?.node)return;
      for(const panel of contributions){if(!enabled.get(panel.id))continue;
        const section=root.ownerDocument.createElement('fieldset'),legend=root.ownerDocument.createElement('legend');legend.textContent=panel.title;section.dataset.editorContribution=panel.id;section.append(legend);
        for(const control of panel.controls){
          const grant=allowed[control.field];if(!grant)continue;
          const minimum=Math.max(control.minimum,grant.minimum),maximum=Math.min(control.maximum,grant.maximum);if(minimum>=maximum)continue;
          const label=root.ownerDocument.createElement('label'),input=root.ownerDocument.createElement('input');label.append(root.ownerDocument.createTextNode(control.label));input.type='number';input.setAttribute('aria-label',control.label);input.min=String(minimum);input.max=String(maximum);input.step=String(control.step);input.value=String(captured.node[control.field]??0);input.disabled=!!captured.locked;label.append(input);section.append(label);
          input.addEventListener('change',()=>{
            if(!current()||!enabled.get(panel.id)||generation!==renderGeneration)return;
            const value=input.valueAsNumber,valid=input.checkValidity();
            Promise.resolve(run(async()=>{
              if(!current()||!enabled.get(panel.id)||generation!==renderGeneration)return;
              const selection=getSelection();fail(!selection.locked,'Unlock this layer to edit it');
              fail(Number.isFinite(value)&&value>=minimum&&value<=maximum&&valid,'Editor value is outside its granted range');
              await edit(()=>{if(!current()||!enabled.get(panel.id)||generation!==renderGeneration)return;fail(!getSelection().locked,'Unlock this layer to edit it');captured.node[control.field]=value;});
            })).catch(()=>{if(current())report('This value could not be applied. Check the layer and try again.');});
          },{signal:controlEvents.signal});
        }
        if(section.querySelector('input'))container.append(section);
      }
    }
    const instance={render,dispose(){if(closed)return;closed=true;controlEvents.abort();container.remove();mounts.delete(instance);}};mounts.add(instance);render();return instance;
  }
  return Object.freeze({contributions,mount,setEnabled(id,value){fail(!disposed&&enabled.has(id)&&typeof value==='boolean','Invalid editor contribution enablement');enabled.set(id,value);for(const instance of mounts)instance.render();},dispose(){if(disposed)return;disposed=true;for(const instance of [...mounts])instance.dispose();}});
}
