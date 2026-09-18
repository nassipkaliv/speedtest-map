import index from '@/public/data/index.json';
import type { DataIndex } from '@/lib/tiles';
import { SpeedMap } from './speed-map';

export default function Home() {
  return <SpeedMap index={index as unknown as DataIndex} />;
}
