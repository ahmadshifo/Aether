import type { Language } from '../shared/types';
export const historyStreamCopy: Record<Language, {
  refresh: string; refreshing: string; more: string; loadingMore: string; retry: string; offline: string; moreError: string;
  clear: string; clearTitle: string; clearBody: string; clearing: string; clearError: string; cleared: string;
  removeLocal: string; removedLocal: string; searchHint: string; sharePhoto: string; reconnecting: string; retryStream: string;
}> = {
  en: {
    refresh: 'Refresh', refreshing: 'Updating History…', more: 'Load older answers', loadingMore: 'Loading older answers…', retry: 'Retry',
    offline: 'History could not update. Available answers are still shown.', moreError: 'Older answers could not load. Try again.',
    clear: 'Clear account history', clearTitle: 'Clear account history?',
    clearBody: 'Delete all your questions and answers from the server and this phone, including answers not loaded here. This cannot be undone. Any active session will stop. Saved camera frames are managed separately.',
    clearing: 'Clearing History…', clearError: 'Deletion could not be confirmed. Refresh to check, or try clearing again.', cleared: 'Account history cleared.',
    removeLocal: 'Remove local copy', removedLocal: 'Local copy removed. The server answer may return after Refresh.',
    searchHint: 'Search covers loaded answers. Load older answers to search more.', sharePhoto: 'Share photo', reconnecting: 'Reconnecting stream…', retryStream: 'Retry stream',
  },
  ar: {
    refresh: 'تحديث', refreshing: 'جارٍ تحديث السجل…', more: 'تحميل إجابات أقدم', loadingMore: 'جارٍ تحميل إجابات أقدم…', retry: 'إعادة المحاولة',
    offline: 'تعذّر تحديث السجل. ما زالت الإجابات المتاحة ظاهرة.', moreError: 'تعذّر تحميل الإجابات الأقدم. حاول مجددًا.',
    clear: 'مسح سجل الحساب', clearTitle: 'مسح سجل الحساب؟',
    clearBody: 'حذف جميع أسئلتك وإجاباتك من الخادم وهذا الهاتف، بما فيها الإجابات غير المحمّلة هنا. لا يمكن التراجع. ستتوقف أي جلسة نشطة. تُدار إطارات الكاميرا المحفوظة بشكل منفصل.',
    clearing: 'جارٍ مسح السجل…', clearError: 'تعذّر تأكيد الحذف. حدّث السجل للتحقّق أو حاول مسحه مجددًا.', cleared: 'تم مسح سجل الحساب.',
    removeLocal: 'إزالة النسخة المحلية', removedLocal: 'أُزيلت النسخة المحلية. قد تعود إجابة الخادم بعد التحديث.',
    searchHint: 'يشمل البحث الإجابات المحمّلة. حمّل إجابات أقدم للبحث في المزيد.', sharePhoto: 'مشاركة الصورة', reconnecting: 'جارٍ إعادة اتصال البث…', retryStream: 'إعادة محاولة البث',
  },
  fr: {
    refresh: 'Actualiser', refreshing: 'Actualisation de l’historique…', more: 'Charger les réponses précédentes', loadingMore: 'Chargement des réponses précédentes…', retry: 'Réessayer',
    offline: 'Impossible d’actualiser l’historique. Les réponses disponibles restent affichées.', moreError: 'Impossible de charger les réponses précédentes. Réessayez.',
    clear: 'Effacer l’historique du compte', clearTitle: 'Effacer l’historique du compte ?',
    clearBody: 'Supprimer toutes vos questions et réponses du serveur et de ce téléphone, même celles qui ne sont pas affichées. Cette action est irréversible. Toute session active sera arrêtée. Les images de la caméra sont gérées séparément.',
    clearing: 'Suppression de l’historique…', clearError: 'La suppression n’a pas pu être confirmée. Actualisez pour vérifier ou réessayez de supprimer.', cleared: 'Historique du compte effacé.',
    removeLocal: 'Retirer la copie locale', removedLocal: 'Copie locale retirée. La réponse du serveur peut revenir après actualisation.',
    searchHint: 'La recherche porte sur les réponses chargées. Chargez les réponses précédentes pour élargir la recherche.', sharePhoto: 'Partager la photo', reconnecting: 'Reconnexion du flux…', retryStream: 'Relancer le flux',
  },
};
