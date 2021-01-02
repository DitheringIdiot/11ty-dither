const dither = require("dither-me-this")
const path = require('path')
const { JSDOM } = require('jsdom')
const fetch = require('node-fetch')
const sh = require('shorthash')
const sharp = require('sharp')


const imageTypes = ['png', 'webp', 'avif']


const defaultConfig = {
    inputDirectory: './src',
    imageFolder: '/images',
    outputDirectory: './_site',
    verbose: false,
    attribute: 'src',
    sizes: [1800, 1024, 720, 600]
}

const defaultDitheringOptions = {
    palette: ["#000", '#FFF']
}

let globalOptions = {}

const pluginTypes = {
    ditherAllImages (eleventyConfig, options) {
        globalOptions = { ...defaultConfig, ...defaultDitheringOptions, ...options }
        eleventyConfig.addTransform('dither', startProcessingImages)
    },
    ditherShortcodes (eleventyConfig, options) {
        eleventyConfig.addShortcode('dither', processImage)
    }
}

const startProcessingImages = async (content, outputPath) => {
    if (outputPath.endsWith('.html')) {
        const dom = new JSDOM(content)
        const images = [...dom.window.document.querySelectorAll('img')]

        if (images.length > 0) {
            await Promise.all(images.map(imgElement => processImage(imgElement, globalOptions)))
            content = dom.serialize()
            return content
        } else {
            return content
        }

    } else {
        return content
    }
}


const processImage = async (imgElement, options) => {

    let config = { ...defaultConfig, ...options }
    let ditheringOptions = { ...defaultDitheringOptions, ...options }
    let imgPath = imgElement.getAttribute('src')

    let filename = fileNameFromPath(imgPath)
    const hash = sh.unique(imgPath)
    let srcsets = []


    await getImage(imgPath, config).then(async (imgBuffer) => {


        await Promise.all(options.sizes.map(size => {
            return resizeImage(imgBuffer, size)
        })).then(async (resizedImages) => {
            const ditheredImages = await ResizedImagesToDither(resizedImages, ditheringOptions)
            return ditheredImages
        }).then(async (ditheredImages) => {



            const allDone = await Promise.all(ditheredImages.map(async (image) => {

                return await Promise.all(imageTypes.map(async (type) => {
                    const hashedFilename = createHashedFilename(hash, image.width, type)
                    const outputFilePath = path.join(config.outputDirectory, config.imageFolder, hashedFilename)
                    const srcPath = path.join(config.imageFolder, hashedFilename)
                    srcsets.push({ path: srcPath, size: image.width, type })
                    return await imageToFile(image.buffer, type, outputFilePath)
                }))

            })).then(() => {
                createPictureElement(srcsets, imgElement)
            })



        })

    })
}

const imageToFile = async (buffer, type, path) => {
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
    return Promise.all(resizedImages.map(async (image) => {
        const options = { ...defaultDitheringOptions, ...ditheringOptions }
        const ditheredBuffer = await dither(image.data, options)
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

const getImage = async (path, config) => {

    if (imageIsExternal(path)) {
        return await downloadImage(path)
    } else {
        return await getImageFromFile(path, config)
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

const getImageFromFile = async (path, config) => {
    return await sharp(`${config.inputDirectory}/${path}`).toBuffer()
}


const createPictureElement = (srcsets, element) => {

    const dom = new JSDOM()

    const imageTypeOrder = ['avif', 'webp', 'png']

    let srcsetsCorrectPath = srcsets.map(srcset => ({ path: srcset.path, size: srcset.size, type: srcset.type }))
    let sortedByImageType = srcsetsCorrectPath.sort((a, b) => {
        return imageTypeOrder.indexOf(a.type) - imageTypeOrder.indexOf(b.type)
    })

    let addedLastOfTypeFlag = sortedByImageType.map((set, i) => {
        const lastOfType = !sortedByImageType[i + 1] || sortedByImageType[i + 1].type !== set.type
        return { ...set, lastOfType }
    })

    let sourceElements = []

    addedLastOfTypeFlag.forEach((source, i) => {
        let mediaString = ''

        if (!source.lastOfType) {
            mediaString = `media="(min-width: ${source.size}px)"`
        }

        let typeString = `type="image/${source.type}"`

        let sourceString = `<source srcset="${source.path}" ${mediaString} ${typeString}>`

        sourceElements.push(sourceString)

    })

    const srcsetString = sourceElements.join('')

    // The fallback should be the largest PNG.
    const largestPNG = addedLastOfTypeFlag.filter(set => set.type === 'png')[0]

    const fallbackSrc = largestPNG.path

    let picture = dom.window.document.createElement('picture')
    picture.innerHTML = srcsetString
    const newImgElement = element.cloneNode(true)
    newImgElement.setAttribute('src', fallbackSrc)
    picture.appendChild(newImgElement)

    element.replaceWith(picture)

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


module.exports = pluginTypes