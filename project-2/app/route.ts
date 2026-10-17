import {serveAsset} from '../server/static.mjs';
export const dynamic='force-dynamic';
export function GET(){return serveAsset('index.html');}
