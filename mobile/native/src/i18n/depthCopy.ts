export const googleArPrivacyUrl = 'https://policies.google.com/privacy';

function formatMeters(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

export const depthCopy = {
  en: {
    title: 'Distance', warnings: 'Nearby obstacle warnings',
    description: 'Speak when the camera detects something ahead within two meters. It may miss low, narrow or reflective obstacles.',
    near: 'Something is close ahead.',
    aim: 'Move the phone slightly, then center the object and hold the phone steady.',
    unavailable: 'Distance readings are unavailable on this camera.',
    measuring: 'Distance sensor active.',
    measured: (meters: number) => {
      const n = formatMeters(meters, 'en');
      return `The surface at the center was about ${n} ${n === '1' ? 'meter' : 'meters'} from your phone.`;
    },
    help: 'Point the camera at the object and ask “How far is the door?” For a named object, your phone sends one picture and its distance reading to Aether. Detected faces are blurred before the AI checks the object.',
    arService: 'On supported Android phones, Aether uses Google Play Services for AR (ARCore) to measure distance. Google provides this service and processes its data under the Google Privacy Policy.',
    privacy: 'Google Privacy Policy', linkError: 'Could not open the privacy policy.',
  },
  fr: {
    title: 'Distance', warnings: 'Alertes d’obstacles proches',
    description: 'Énonce une alerte si la caméra détecte un obstacle devant vous à moins de deux mètres. Certains obstacles bas, étroits ou réfléchissants peuvent passer inaperçus.',
    near: 'Quelque chose est proche, devant vous.',
    aim: 'Bougez légèrement le téléphone, puis centrez l’objet et tenez le téléphone immobile.',
    unavailable: 'La mesure de distance est indisponible avec cette caméra.',
    measuring: 'Le capteur de distance est actif.',
    measured: (meters: number) => `La surface au centre était à environ ${formatMeters(meters, 'fr')} ${Math.round(meters * 10) < 20 ? 'mètre' : 'mètres'} du téléphone.`,
    help: 'Visez l’objet et demandez « À quelle distance est la porte ? ». Pour un objet nommé, le téléphone transmet une image et la distance mesurée à Aether. Les visages détectés sont floutés avant que l’IA vérifie l’objet.',
    arService: 'Sur les téléphones Android compatibles, Aether mesure les distances avec les services Google Play pour la RA (ARCore). Google fournit ce service et traite ses données selon ses règles de confidentialité.',
    privacy: 'Règles de confidentialité de Google', linkError: 'Impossible d’ouvrir les règles de confidentialité.',
  },
  ar: {
    title: 'المسافة', warnings: 'تنبيهات العوائق القريبة',
    description: 'ينطق الهاتف بتنبيه عندما ترصد الكاميرا عائقًا أمامك على بُعد أقل من مترين. قد تفوتها العوائق المنخفضة أو الرفيعة أو العاكسة.',
    near: 'هناك شيء قريب أمامك.',
    aim: 'حرّك الهاتف قليلًا، ثم وجّه وسط الكاميرا نحو الجسم وثبّت الهاتف.',
    unavailable: 'قياس المسافة غير متاح بهذه الكاميرا.',
    measuring: 'مستشعر المسافة يعمل.',
    measured: (meters: number) => `بلغت المسافة بين الهاتف والسطح في وسط الصورة نحو ${formatMeters(meters, 'ar-EG')} متر عند القياس.`,
    help: 'وجّه الكاميرا نحو الجسم واسأل «كم يبعد الباب؟». عندما تسأل عن جسم محدّد، يرسل هاتفك صورة واحدة وقياس المسافة إلى إيثر. تُموَّه الوجوه المكتشفة قبل أن يتحقق الذكاء الاصطناعي من الجسم.',
    arService: 'على هواتف أندرويد المدعومة، يستخدم إيثر خدمات Google Play للواقع المعزز (ARCore) لقياس المسافة. تقدّم Google هذه الخدمة وتعالج بياناتها وفق سياسة خصوصية Google.',
    privacy: 'سياسة خصوصية Google', linkError: 'تعذّر فتح سياسة الخصوصية.',
  },
} as const;
