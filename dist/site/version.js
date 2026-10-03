// Letterman's version: the one place it is written. The family version rule (project standard, slot 8):
// 0.y.z stays below 1.0.0 until the stable public release; y moves on entering alpha and on each package
// for the trusted testers; z counts completed turns inside the stage. The build reads this file, the page
// and the console show it, and the offline cache is named after it.
self.LETTERMAN_VERSION = { version: '0.1.1', stage: 'alpha' };
