import type { BunPressOptions } from 'bunpress'

const config: BunPressOptions = {
  name: 'audiox',
  description: 'Powerful audio processing for your media workflows',
  url: 'https://audiox.stacksjs.org',
  theme: {
    primaryColor: '#6366f1',
  },
  nav: [
    { text: 'Guide', link: '/intro' },
    { text: 'Features', link: '/features/audio-conversion' },
    { text: 'Advanced', link: '/advanced/configuration' },
    {
      text: 'Changelog',
      link: 'https://github.com/stacksjs/audiox/blob/main/CHANGELOG.md',
    },
  ],
  sidebar: [
    {
      text: 'Introduction',
      items: [
        { text: 'What is Audiox?', link: '/intro' },
        { text: 'Installation', link: '/install' },
        { text: 'Usage', link: '/usage' },
        { text: 'Configuration', link: '/config' },
      ],
    },
    {
      text: 'Guide',
      items: [
        { text: 'Getting Started', link: '/usage' },
        { text: 'CLI Commands', link: '/usage#cli-usage' },
        { text: 'Library API', link: '/usage#library-usage' },
      ],
    },
    {
      text: 'Features',
      items: [
        { text: 'Audio Conversion', link: '/features/audio-conversion' },
        { text: 'Format Support', link: '/features/format-support' },
        { text: 'Batch Processing', link: '/features/batch-processing' },
        { text: 'Metadata Handling', link: '/features/metadata-handling' },
      ],
    },
    {
      text: 'Advanced',
      items: [
        { text: 'Configuration', link: '/advanced/configuration' },
        { text: 'Custom Pipelines', link: '/advanced/custom-pipelines' },
        { text: 'Performance', link: '/advanced/performance' },
        { text: 'CI/CD Integration', link: '/advanced/ci-cd-integration' },
      ],
    },
  ],
  sitemap: {
    enabled: true,
    baseUrl: 'https://audiox.stacksjs.org',
  },
  robots: {
    enabled: true,
  },
}

export default config
