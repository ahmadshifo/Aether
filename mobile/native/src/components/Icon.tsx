// Adapted from mobile/frontend/src/EchoIcon.tsx at bb54dbd; native SVG primitives.
import type { ReactNode } from 'react'
import Svg, { Path, Rect, Circle, type SvgProps } from 'react-native-svg'

type IconName =
  | 'home' | 'settings' | 'eye' | 'camera' | 'camera-off' | 'mic' | 'mic-off'
  | 'history' | 'close' | 'arrow-left' | 'arrow-right'
  | 'volume' | 'sparkles' | 'check' | 'loader' | 'radio'
  | 'circle-help' | 'stop' | 'audio-lines' | 'logout' | 'search' | 'more' | 'copy' | 'trash' | 'share' | 'plus' | 'minus'

type Props = SvgProps & { name: IconName; size?: number }

export default function EchoIcon({ name, size = 22, ...props }: Props) {
  const paths: Record<IconName, ReactNode> = {
    home: <><Path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/></>,
    settings: <><Path d="M4 6h16M4 12h16M4 18h16"/><Rect x="7" y="3" width="4" height="6" rx="1" fill="none"/><Rect x="14" y="9" width="4" height="6" rx="1" fill="none"/><Rect x="6" y="15" width="4" height="6" rx="1" fill="none"/></>,
    logout: <><Path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M9 12h12m-4-4 4 4-4 4"/></>,
    search: <><Circle cx="10" cy="10" r="6.5"/><Path d="m15 15 6 6"/></>,
    more: <><Circle cx="5" cy="12" r="1"/><Circle cx="12" cy="12" r="1"/><Circle cx="19" cy="12" r="1"/></>,
    copy: <><Rect x="8" y="8" width="12" height="13" rx="2"/><Path d="M16 8V3H3v13h5"/></>,
    trash: <><Path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
    share: <><Path d="M12 16V3m-4 4 4-4 4 4M5 11v10h14V11"/></>,
    plus: <Path d="M5 12h14M12 5v14"/>,
    minus: <Path d="M5 12h14"/>,
    eye: <><Path d="M2.1 12s3.6-7 9.9-7 9.9 7 9.9 7-3.6 7-9.9 7S2.1 12 2.1 12Z"/><Circle cx="12" cy="12" r="3"/></>,
    camera: <><Path d="M14.5 4H9.5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5L14.5 4Z"/><Circle cx="12" cy="13.5" r="3.3"/></>,
    'camera-off': <><Path d="m2 2 20 20M9.5 4h5l2 3H20a2 2 0 0 1 2 2v9a2 2 0 0 1-.7 1.5M4 7h2.2L7.5 5M2 10v8a2 2 0 0 0 2 2h13"/><Path d="M10 10a3.4 3.4 0 0 0 4 4"/></>,
    mic: <><Rect x="9" y="2" width="6" height="13" rx="3"/><Path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8"/></>,
    'mic-off': <><Path d="m2 2 20 20M9 9v3a3 3 0 0 0 4.7 2.5M15 9V5a3 3 0 0 0-5.5-1.7M5 11a7 7 0 0 0 12 4.9M19 11a7 7 0 0 1-.7 3M12 18v4m-4 0h8"/></>,
    history: <><Path d="M3 12a9 9 0 1 0 3-6.7M3 3v5h5"/><Path d="M12 7v5l3 2"/></>,
    close: <Path d="M18 6 6 18M6 6l12 12"/>,
    'arrow-left': <><Path d="m12 19-7-7 7-7M5 12h14"/></>,
    'arrow-right': <><Path d="m12 5 7 7-7 7M19 12H5"/></>,
    volume: <><Path d="M11 5 6 9H3v6h3l5 4V5ZM15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/></>,
    sparkles: <><Path d="m12 2 1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    check: <Path d="m5 12 4 4L19 6"/>,
    loader: <Path d="M12 2a10 10 0 1 1-10 10"/>,
    radio: <><Circle cx="12" cy="12" r="2"/><Path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/></>,
    'circle-help': <><Circle cx="12" cy="12" r="10"/><Path d="M9.5 9a2.6 2.6 0 1 1 4.2 2c-.9.7-1.7 1.2-1.7 2.5M12 17h.01"/></>,
    stop: <Rect x="7" y="7" width="10" height="10" rx="1.5"/>,
    'audio-lines': <><Path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4"/></>,
  }

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
      focusable={false}
      {...props}
    >
      {paths[name]}
    </Svg>
  )
}
