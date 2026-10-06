export type ActionJson=null|boolean|number|string|ActionJson[]|{[key:string]:ActionJson};
export interface ActionDelivery {
  protocol:'digital-card-action@1';pluginId:string;handlerId:string;jobId:string;
  beneficiaryId:string|null;source:{[key:string]:ActionJson};params:{[key:string]:ActionJson};
}
export interface ActionAcknowledgment {protocol:'digital-card-action@1';pluginId:string;jobId:string;status:'completed'}
export declare const actionProtocol:'digital-card-action@1';
export declare const actionDeliverySchema:Readonly<Record<string,unknown>>;
export declare function validateActionDelivery(value:unknown):ActionDelivery;
export declare function validateActionAcknowledgment(value:unknown):ActionAcknowledgment;
