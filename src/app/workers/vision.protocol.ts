import type { BraceletDetection } from '../../features/bracelet/models/vision.types';
export type WorkerReply = {type:'ready'} | {type:'error';message:string} | (BraceletDetection & {type:'result';frame?:ImageBitmap});
