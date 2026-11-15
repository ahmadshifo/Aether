import type { Language } from '../shared/types.ts';
import type { ContactFailure } from '../platform/contactErrors.ts';

export const contactCopy: Record<Language, Record<ContactFailure, string>> = {
  en: {
    permission: 'Aether cannot access your contacts. Allow Contacts access for Aether in your phone settings.',
    limited: 'Aether can only see selected contacts. Add this person to Aether’s allowed contacts in your phone settings.',
    unavailable: 'This app build cannot read contacts. Install the updated Aether app.',
    readFailed: 'I could not read your contacts. Please try again.',
    noNumber: 'I found the contact, but it has no saved phone number.',
  },
  ar: {
    permission: 'لا يستطيع أيثر الوصول إلى جهات اتصالك. اسمح له بالوصول إلى جهات الاتصال من إعدادات هاتفك.',
    limited: 'يمكن لأيثر رؤية جهات الاتصال المحددة فقط. أضف هذا الشخص إلى جهات الاتصال المسموح بها لأيثر في إعدادات هاتفك.',
    unavailable: 'لا يستطيع هذا الإصدار قراءة جهات الاتصال. ثبّت الإصدار المحدّث من أيثر.',
    readFailed: 'لم أستطع قراءة جهات اتصالك. حاول مجددًا من فضلك.',
    noNumber: 'وجدت جهة الاتصال، لكن لا يوجد رقم هاتف محفوظ لها.',
  },
  fr: {
    permission: 'Aether ne peut pas accéder à vos contacts. Autorisez cet accès dans les réglages de votre téléphone.',
    limited: 'Aether voit uniquement les contacts sélectionnés. Ajoutez cette personne aux contacts autorisés pour Aether dans les réglages.',
    unavailable: 'Cette version ne peut pas lire vos contacts. Installez la version mise à jour d’Aether.',
    readFailed: 'Je n’ai pas pu lire vos contacts. Veuillez réessayer.',
    noNumber: 'J’ai trouvé le contact, mais aucun numéro de téléphone n’est enregistré.',
  },
};
