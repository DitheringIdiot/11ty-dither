const dither = require("dither-me-this")
const fs = require('fs-extra')
const path = require('path')
const { JSDOM } = require('jsdom')
const fetch = require('node-fetch')
const sh = require('shorthash')
const fileType = require('file-type')
const { createCanvas, createImageData, Image } = require('canvas')
const sharp = require('sharp')


const imageTypes = ['png', 'webp']


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
            await Promise.all(images.map(img => processImage(img, globalOptions)))
            content = dom.serialize()
            return content
        } else {
            return content
        }

    } else {
        return content
    }
}


const processImage = async (img, options) => {

    let config = { ...defaultConfig, ...options }
    let ditheringOptions = { ...defaultDitheringOptions, ...options }
    let imgPath = img.getAttribute('src')

    let filename = fileNameFromPath(imgPath)
    const hash = sh.unique(imgPath)
    let srcsets = []



    await getImage(imgPath, config).then(async (imgBuffer) => {


        await Promise.all(options.sizes.map(size => {
            return resizeImage(imgBuffer, size)
        })).then(async (resizedImages) => {
            const ditheredImages = await ResizedImagesToDither(resizedImages, ditheringOptions)
            return ditheredImages
        }).then(ditheredImages => {

            ditheredImages.forEach(image => {

                if (imageTypes.includes('png')) {
                    let type = 'png'
                    const hashedFilename = !path.extname(filename) ? `${hash}-${image.width}.${type}` : `${hash}-${image.width}-${filename}`
                    let outputFilePath = path.join(config.outputDirectory, config.imageFolder, hashedFilename)
                    let srcPath = path.join(config.imageFolder, hashedFilename)
                    sharp(image.buffer).png().toFile(outputFilePath)
                    srcsets.push({ path: srcPath, size: image.width, type })
                }

                // if (imageTypes.includes('webp')) {
                //     let base64Image = resizedImage.split(';base64,').pop()
                //     fs.outputFile(outputFilePath, base64Image, { encoding: 'base64' })
                // }
            })


            createPictureElement(srcsets, img)
        })

    })
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

    let srcsetsCorrectPath = srcsets.map(srcset => ({ path: srcset.path, size: srcset.size, type: srcset.type }))

    let sourceElements = []

    srcsetsCorrectPath.forEach((srcset, i) => {
        let mediaString = ''

        if (i < srcsetsCorrectPath.length - 1) {
            mediaString = `media="(min-width: ${srcset.size}px)"`
        }

        let sourceString = `<source srcset="${srcset.path}" ${mediaString}>`

        sourceElements.push(sourceString)

    })

    const srcsetString = sourceElements.join('')

    const fallbackSrc = srcsetsCorrectPath[0].path

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