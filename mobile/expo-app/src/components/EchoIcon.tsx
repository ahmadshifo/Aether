import Svg, { Circle, Path, Rect } from 'react-native-svg';
export type IconName = 'eye' | 'stop' | 'history' | 'volume' | 'close' | 'back' | 'sparkles' | 'chevron';
export function EchoIcon({ name, size = 24, color = '#2dd4bf' }: { name: IconName; size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" accessible={false}>
    {name === 'eye' && <><Path d="M2.1 12s3.6-7 9.9-7 9.9 7 9.9 7-3.6 7-9.9 7S2.1 12 2.1 12Z"/><Circle cx={12} cy={12} r={3}/></>}
    {name === 'stop' && <Rect x={7} y={7} width={10} height={10} rx={1.5}/>}
    {name === 'history' && <><Path d="M3 12a9 9 0 1 0 3-6.7M3 3v5h5"/><Path d="M12 7v5l3 2"/></>}
    {name === 'volume' && <Path d="M11 5 6 9H3v6h3l5 4V5ZM15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/>}
    {name === 'close' && <Path d="m18 6-12 12M6 6l12 12"/>}
    {name === 'back' && <Path d="m12 19-7-7 7-7M5 12h14"/>}
    {name === 'chevron' && <Path d="m6 9 6 6 6-6"/>}
    {name === 'sparkles' && <Path d="m12 2 1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>}
  </Svg>;
}
