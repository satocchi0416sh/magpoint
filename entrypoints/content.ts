import { startMagnet } from '../lib/magnet';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    startMagnet();
  },
});
