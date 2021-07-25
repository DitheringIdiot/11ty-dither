const dither = require("dither-me-this")
const path = require('path')
const { JSDOM } = require('jsdom')
const fetch = require('node-fetch')
const sh = require('shorthash')
const sharp = require('sharp')
const fs = require('fs')


const imageTypes = ['png', 'webp', 'avif']


const defaultOptions = {
    inputDirectory: './src',
    outputDirectory: './_site',
    imageFolder: '/images',
    sizes: [1800, 1024, 720, 600],
    formats: ['png', 'webp', 'avif'],
    ditheringOptions: {
        palette: ["#000", '#FFF']
    }
}

const pluginTypes = {
    ditherShortcodes (eleventyConfig, globalOptions) {
        eleventyConfig.addPairedNunjucksAsyncShortcode('dither', async (content, src, alt, options) => {
            const htmlString = await processImageFromShortcode(content, src, alt, options, globalOptions)
            return htmlString
        })
    }
}

// const startProcessingImages = async (content, outputPath) => { // TODO - THIS NEEDS A CLEARER NAME
//     if (outputPath.endsWith('.html')) {
//         const dom = new JSDOM(content)
//         const images = [...dom.window.document.querySelectorAll('img')]

//         if (images.length > 0) {
//             await Promise.all(images.map(imgElement => processImage(imgElement, globalOptions)))
//             content = dom.serialize()
//             return content
//         } else {
//             return content
//         }

//     } else {
//         return content
//     }
// }

const processImageFromShortcode = async (content, src, alt, options, globalOptions) => {
    const ditherImageObject = shortcodeToDitherObject(src, alt, content, options)
    return await processImage(ditherImageObject, globalOptions)
}

const shortcodeToDitherObject = (src, alt, caption, options) => {

    const ditherImageObject = {
        src: src,
        alt: alt || "",
        caption: caption || "",
        options: options || "default"
    }

    return ditherImageObject
}

// const imgElementToDitherObject = (imgElement, options) => {


//     let config = { ...defaultOptions, ...options }
//     let ditheringOptions = { ...defaultDitheringOptions, ...options }

//     const ditherImageObject = {
//         src: imgElement.getAttribute('src') || null,
//         alt: element.getAttribute('alt') || null,
//         caption: null,
//         options: {} // TODO - make this get the default options!?

//     }
// }


const getImageOptions = (globalOptions, imageSpecificOptions) => {

    const presetString = typeof imageSpecificOptions.options === 'string' ? imageSpecificOptions.options : null

    const presets = globalOptions.presets || {}

    const presetOptions = presetString && presets[presetString] ? presets[presetString] : {}

    const presetDitheringOptions = presetOptions.ditheringOptions || {}

    const userDefaultOptions = globalOptions.default || {}
    const userDefaultDitheringOptions = userDefaultOptions.ditheringOptions || {}

    const imageSpecificDitheringOptions = typeof imageSpecificOptions.options !== 'string' ? imageSpecificOptions.options.ditheringOptions : {}

    const ditheringOptions = {
        ...defaultOptions.ditheringOptions,
        ...userDefaultDitheringOptions,
        ...presetDitheringOptions,
        ...imageSpecificDitheringOptions
    }



    const options = {
        ...defaultOptions,
        ...userDefaultOptions,
        ...presetOptions,
        ...imageSpecificOptions,
        ditheringOptions: ditheringOptions
    }

    return options
}



const processImage = async (ditherImageObject, globalOptions) => {

    const options = getImageOptions(globalOptions, ditherImageObject)


    // let filename = fileNameFromPath(ditherImageObject.src)
    const hash = sh.unique(ditherImageObject.src)

    const srcsets = options.sizes.map(size => {
        return options.formats.map(format => {
            const hashedFilename = createHashedFilename(hash, size, format)
            return {
                format,
                size,
                hashedFilename: hashedFilename,
                outputFilePath: path.join(options.outputDirectory, options.imageFolder, hashedFilename),
                imageFolder: options.outputDirectory + options.imageFolder,
                src: path.join(options.imageFolder, hashedFilename),
            }
        })
    }).flat()

    // This function gets the images, resizes them, dithres them, and then saves them in the correct formats 
    await getImage(ditherImageObject.src, options).then(async (imgBuffer) => {
        return await Promise.all(options.sizes.map(size => {
            return resizeImage(imgBuffer, size)
        })).then(async (resizedImages) => {
            return await ResizedImagesToDither(resizedImages, options.ditheringOptions)
        }).then(async (ditheredImages) => {
            return await Promise.all(srcsets.map(async (srcset) => {
                const image = ditheredImages.find(image => image.width === srcset.size)
                return imageToFile(image.buffer, srcset.format, srcset.outputFilePath, srcset.imageFolder)
            }))
        })
    })

    return createPictureElement(srcsets, ditherImageObject)

}

const imageToFile = async (buffer, type, path, imageFolder) => {



    if (!fs.existsSync(imageFolder)) {
        fs.mkdir(imageFolder, { recursive: true }, (err) => {
            if (err) throw err
        })
    }


    if (type === 'webp') {
        return sharp(buffer).webp({ lossless: true }).toFile(path)
    } else if (type === 'avif') {
        return sharp(buffer).avif({ lossless: true }).toFile(path)
    } else {
        return sharp(buffer).png().toFile(path)
    }
}

const createHashedFilename = (hash, size, type) => {
    return `${hash}-${size}.${type}`
}


const ResizedImagesToDither = async (resizedImages, ditheringOptions) => {
    console.log(ditheringOptions)
    return Promise.all(resizedImages.map(async (image) => {
        const ditheredBuffer = await dither(image.data, ditheringOptions)
        return {
            buffer: ditheredBuffer,
            width: image.info.width,
            height: image.info.height
        }
    }))
}


const resizeImage = async (imageBuffer, size) => {
    let resizedImage = await sharp(imageBuffer)
        .png()
        .resize({ width: size })
        .toBuffer({ resolveWithObject: true })

    return resizedImage
}

const getImage = async (path, options) => {

    if (imageIsExternal(path)) {
        return await downloadImage(path)
    } else {
        return await getImageFromFile(path, options)
    }
}

const downloadImage = async (path) => {
    try {
        const imgBuffer = await fetch(path)
            .then(res => {
                if (res.status == 200) {
                    return res
                } else {
                    throw new Error(`File "${path}" not found`)
                }
            }).then(res => res.buffer())
        return imgBuffer
    } catch (error) {
        console.log(error)
    }
}

const getImageFromFile = async (path, options) => {
    return await sharp(`${options.inputDirectory}/${path}`).toBuffer()
}


const createPictureElement = (srcset, options) => {


    const imageTypeOrder = ['avif', 'webp', 'png']


    let sortedByImageType = srcset.sort((a, b) => {
        return imageTypeOrder.indexOf(a.format) - imageTypeOrder.indexOf(b.format)
    })

    let addedLastOfTypeFlag = sortedByImageType.map((source, i) => {
        const lastOfType = !sortedByImageType[i + 1] || sortedByImageType[i + 1].format !== source.format
        return { ...source, lastOfType }
    })

    let sourceElements = []

    addedLastOfTypeFlag.forEach((source) => {
        let mediaString = ''

        if (!source.lastOfType) {
            mediaString = `media="(min-width: ${source.size}px)"`
        }

        let typeString = `type="image/${source.format}"`

        let sourceString = `<source srcset="${source.src}" ${mediaString} ${typeString}>`

        sourceElements.push(sourceString)

    })

    const srcsetString = sourceElements.join('')

    // The fallback should be the largest PNG.
    const largestPNG = addedLastOfTypeFlag.filter(set => set.format === 'png')[0]

    const fallbackSrc = largestPNG.src

    const picture = `<figure>
                    <picture>
                        ${srcsetString}
                        <img src="${fallbackSrc}" alt="${options.alt}">
                    </picture>
                    <figcaption>
                        ${options.caption}
                    </figcaption>
                    </figure>`.replace(/\s+/g, ' ').replace(/[\n\r]/g, '')

    return picture

}


const fileNameFromPath = (path) => {
    const pathComponents = path.split('/')
    let filename = pathComponents[pathComponents.length - 1].split("?")
    return filename[0]
}

const imageIsExternal = (path) => {
    // const regexp = /[(http(s)?):\/\/(www\.)?a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/
    // return regexp.test(path)
    return path.includes('https://') || path.includes('http://')
}

/*

ImageToDither {

    src:string
    alt:string
    caption:string

    options:{
        sizes:[number]
        formats:[( 'png' | 'webp' | 'avif' )]
        ditheringOptions: DitheringOptions
    } | string
}

DitheringOptions {
    dither: 'errorDiffusion', // ordered, random, errorDiffusion, none
    random: 'blackAndWhite', // blackAndWhite, Color
    ordered: {
        type: 'bayer',
        matrix: [4, 4]
    },
    errorDiffusion: {
        type: 'Sierra2-4A'
    },
    palette: 'default', // color[], 'palette name'
    threshold: 50,
    serpentine: false,
    numberOfColors: 10
}
 */



module.exports = pluginTypes