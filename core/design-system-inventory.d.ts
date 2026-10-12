export const DESIGN_SYSTEM_SOURCE:Readonly<{repository:string;revision:string;license:null;verifiedAt:string;catalog:string}>;
export interface DesignSystemReference {id:string;name:string;version:string|null;path:string;level:number;distinction:string;source:typeof DESIGN_SYSTEM_SOURCE;redistribution:'review-required'}
export function listDesignSystemReferences():DesignSystemReference[];
