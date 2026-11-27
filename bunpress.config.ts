import type { BunPressOptions } from '@stacksjs/bunpress'

const config: BunPressOptions = {
  title: 'ts-audio',
  description: 'Reading, writing and decoding audio in TypeScript. No native dependencies, no ffmpeg.',
  url: 'https://ts-audio.stacksjs.org',
  themeConfig: {
    colors: {
      primary: '#6366f1',
    },
  },
  nav: [
    { text: 'Guide', link: '/intro' },
    { text: 'Features', link: '/features/decoding' },
    { text: 'Advanced', link: '/advanced/stream-processing' },
    {
      text: 'Changelog',
      link: 'https://github.com/stacksjs/ts-audio/blob/main/CHANGELOG.md',
    },
  ],
  sidebar: [
    {
      text: 'Introduction',
      items: [
        { text: 'What is ts-audio?', link: '/intro' },
        { text: 'Installation', link: '/install' },
        { text: 'Usage', link: '/usage' },
      ],
    },
    {
      text: 'Features',
      items: [
        { text: 'Decoding Audio', link: '/features/decoding' },
        { text: 'Format Support', link: '/features/format-support' },
        { text: 'Conversion', link: '/features/audio-conversion' },
        { text: 'Metadata', link: '/features/metadata-handling' },
        { text: 'CLI', link: '/features/cli-usage' },
      ],
    },
    {
      text: 'Advanced',
      items: [
        { text: 'Sources and Targets', link: '/advanced/stream-processing' },
        { text: 'Delivery Plans', link: '/advanced/custom-pipelines' },
        { text: 'Derivatives', link: '/advanced/derivatives' },
        { text: 'Performance', link: '/advanced/performance' },
      ],
    },
  ],
  sitemap: {
    enabled: true,
    baseUrl: 'https://ts-audio.stacksjs.org',
  },
  robots: {
    enabled: true,
  },
}

export default config
