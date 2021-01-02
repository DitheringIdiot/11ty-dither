**Not Ready for Production**

# @11ty-dither

Dither images at build time for 11ty using dither-me-this.

11ty-dither takes a source image, and outputs dithered images in multiple sizes and formats. 
It replaces your `<img>` element with a responsive `<picture>` element.

@11ty-dither and dither-me-this are open source projects. You can contribute via github.


## Setup

```
npm install @11ty-dither
```

```
const { ditherAllImages } = require('@11ty-dither')

module.exports = (eleventyConfig) => {

    const ditherOptions = {
        
        /* Options for dither-me-this work here */

        inputDirectory: './src',
        outputDirectory: './_site',
        imageFolder: '/images',
        palette: ["#000", "#FFF"]
    }

    eleventyConfig.addPlugin(ditherAllImages, ditherOptions)

}

```