/* eslint-env mocha */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
const expect = chai.expect
const path = require('path')
const loadFixture = require('aegir/fixtures')
const isNode = require('detect-node')
const values = require('pull-stream/sources/values')
const bufferStream = require('pull-buffer-stream')
const multihash = require('multihashes')
const {
  collectLeafCids,
  createMfs,
  cidAtPath,
  createShardedDirectory,
  createTwoShards
} = require('./helpers')
const CID = require('cids')

let fs

if (isNode) {
  fs = require('fs')
}

describe('write', function () {
  let mfs
  let smallFile = loadFixture(path.join('test', 'fixtures', 'small-file.txt'))
  let largeFile = loadFixture(path.join('test', 'fixtures', 'large-file.jpg'))

  const runTest = (fn) => {
    let i = 0
    const iterations = 5
    const files = [{
      type: 'Small file',
      path: `/small-file-${Math.random()}.txt`,
      content: smallFile,
      contentSize: smallFile.length
    }, {
      type: 'Large file',
      path: `/large-file-${Math.random()}.jpg`,
      content: largeFile,
      contentSize: largeFile.length
    }, {
      type: 'Really large file',
      path: `/really-large-file-${Math.random()}.jpg`,
      content: (end, callback) => {
        if (end) {
          return callback(end)
        }

        if (i === iterations) {
          // Ugh. https://github.com/standard/standard/issues/623
          const foo = true
          return callback(foo)
        }

        i++
        callback(null, largeFile)
      },
      contentSize: largeFile.length * iterations
    }]

    files.forEach((file) => {
      fn(file)
    })
  }

  before(() => {
    return createMfs()
      .then(instance => {
        mfs = instance
      })
  })

  it('explodes if it cannot convert content to a pull stream', () => {
    return mfs.write('/foo', -1, {
      create: true
    })
      .then(() => expect(false).to.equal(true))
      .catch((error) => {
        expect(error.message).to.contain('Don\'t know how to convert -1 into a pull stream source')
      })
  })

  it('explodes if given an invalid path', () => {
    return mfs.write('foo', null, {
      create: true
    })
      .then(() => expect(false).to.equal(true))
      .catch((error) => {
        expect(error.message).to.contain('paths must start with a leading /')
      })
  })

  it('explodes if given a negtive offset', () => {
    return mfs.write('/foo.txt', Buffer.from('foo'), {
      offset: -1
    })
      .then(() => expect(false).to.equal(true))
      .catch((error) => {
        expect(error.message).to.contain('cannot have negative write offset')
      })
  })

  it('explodes if given a negative length', () => {
    return mfs.write('/foo.txt', Buffer.from('foo'), {
      length: -1
    })
      .then(() => expect(false).to.equal(true))
      .catch((error) => {
        expect(error.message).to.contain('cannot have negative byte count')
      })
  })

  it('creates a zero length file when passed a zero length', () => {
    return mfs.write('/foo.txt', Buffer.from('foo'), {
      length: 0,
      create: true
    })
      .then(() => mfs.ls('/', {
        long: true
      }))
      .then((files) => {
        expect(files.length).to.equal(1)
        expect(files[0].name).to.equal('foo.txt')
        expect(files[0].size).to.equal(0)
      })
  })

  it('writes a small file using a buffer', () => {
    const filePath = `/small-file-${Math.random()}.txt`

    return mfs.write(filePath, smallFile, {
      create: true
    })
      .then(() => mfs.stat(filePath))
      .then((stats) => {
        expect(stats.size).to.equal(smallFile.length)
      })
  })

  it('writes a small file using a path (Node only)', function () {
    if (!isNode) {
      return this.skip()
    }

    const filePath = `/small-file-${Math.random()}.txt`
    const pathToFile = path.resolve(path.join(__dirname, 'fixtures', 'small-file.txt'))

    return mfs.write(filePath, pathToFile, {
      create: true
    })
      .then(() => mfs.stat(filePath))
      .then((stats) => {
        expect(stats.size).to.equal(smallFile.length)
      })
  })

  it('writes part of a small file using a path (Node only)', function () {
    if (!isNode) {
      return this.skip()
    }

    const filePath = `/small-file-${Math.random()}.txt`
    const pathToFile = path.resolve(path.join(__dirname, 'fixtures', 'small-file.txt'))

    return mfs.write(filePath, pathToFile, {
      create: true,
      length: 2
    })
      .then(() => mfs.stat(filePath))
      .then((stats) => {
        expect(stats.size).to.equal(2)
      })
  })

  it('writes a small file using a Node stream (Node only)', function () {
    if (!isNode) {
      return this.skip()
    }

    const filePath = `/small-file-${Math.random()}.txt`
    const pathToFile = path.resolve(path.join(__dirname, 'fixtures', 'small-file.txt'))
    const stream = fs.createReadStream(pathToFile)

    return mfs.write(filePath, stream, {
      create: true
    })
      .then(() => mfs.stat(filePath))
      .then((stats) => {
        expect(stats.size).to.equal(smallFile.length)
      })
  })

  it('writes a small file using a pull stream source', function () {
    const filePath = `/small-file-${Math.random()}.txt`

    return mfs.write(filePath, values([smallFile]), {
      create: true
    })
      .then(() => mfs.stat(filePath))
      .then((stats) => {
        expect(stats.size).to.equal(smallFile.length)
      })
  })

  it('writes a small file using an HTML5 Blob (Browser only)', function () {
    if (!global.Blob) {
      return this.skip()
    }

    const filePath = `/small-file-${Math.random()}.txt`
    const blob = new global.Blob([smallFile.buffer.slice(smallFile.byteOffset, smallFile.byteOffset + smallFile.byteLength)])

    return mfs.write(filePath, blob, {
      create: true
    })
      .then(() => mfs.stat(filePath))
      .then((stats) => {
        expect(stats.size).to.equal(smallFile.length)
      })
  })

  it('writes a small file with an escaped slash in the title', async () => {
    const filePath = `/small-\\/file-${Math.random()}.txt`

    await mfs.write(filePath, smallFile, {
      create: true
    })

    const stats = await mfs.stat(filePath)

    expect(stats.size).to.equal(smallFile.length)

    try {
      await mfs.stat('/small-\\')
      throw new Error('Created path section before escape as directory')
    } catch (error) {
      expect(error.message).to.include('does not exist')
    }
  })

  it('writes a deeply nested small file', () => {
    const filePath = '/foo/bar/baz/qux/quux/garply/small-file.txt'

    return mfs.write(filePath, smallFile, {
      create: true,
      parents: true
    })
      .then(() => mfs.stat(filePath))
      .then((stats) => {
        expect(stats.size).to.equal(smallFile.length)
      })
  })

  it('refuses to write to a file in a folder that does not exist', () => {
    const filePath = `/${Math.random()}/small-file.txt`

    return mfs.write(filePath, smallFile, {
      create: true
    })
      .then(() => {
        throw new Error('Writing a file to a non-existent folder without the --parents flag should have failed')
      })
      .catch((error) => {
        expect(error.message).to.contain('does not exist')
      })
  })

  it('refuses to write to a file that does not exist', () => {
    const filePath = `/small-file-${Math.random()}.txt`

    return mfs.write(filePath, smallFile)
      .then(() => {
        throw new Error('Writing a file to a non-existent file without the --create flag should have failed')
      })
      .catch((error) => {
        expect(error.message).to.contain('file does not exist')
      })
  })

  it('refuses to write to a path that has a file in it', async () => {
    const filePath = `/small-file-${Math.random()}.txt`

    await mfs.write(filePath, Buffer.from([0, 1, 2, 3]), {
      create: true
    })

    try {
      await mfs.write(`${filePath}/other-file-${Math.random()}.txt`, Buffer.from([0, 1, 2, 3]), {
        create: true
      })

      throw new Error('Writing a path with a file in it should have failed')
    } catch (error) {
      expect(error.message).to.contain('Not a directory')
    }
  })

  runTest(({ type, path, content }) => {
    it(`limits how many bytes to write to a file (${type})`, () => {
      return mfs.write(path, content, {
        create: true,
        parents: true,
        length: 2
      })
        .then(() => mfs.read(path))
        .then((buffer) => {
          expect(buffer.length).to.equal(2)
        })
    })
  })

  runTest(({ type, path, content, contentSize }) => {
    it(`overwrites start of a file without truncating (${type})`, () => {
      const newContent = Buffer.from('Goodbye world')

      return mfs.write(path, content, {
        create: true
      })
        .then(() => mfs.write(path, newContent))
        .then(() => mfs.stat(path))
        .then((stats) => expect(stats.size).to.equal(contentSize))
        .then(() => mfs.read(path, {
          offset: 0,
          length: newContent.length
        }))
        .then((buffer) => expect(buffer).to.deep.equal(newContent))
    })
  })

  runTest(({ type, path, content, contentSize }) => {
    it(`pads the start of a new file when an offset is specified (${type})`, () => {
      const offset = 10

      return mfs.write(path, content, {
        offset,
        create: true
      })
        .then(() => mfs.stat(path))
        .then((stats) => {
          expect(stats.size).to.equal(offset + contentSize)
        })
        .then(() => mfs.read(path, {
          offset: 0,
          length: offset
        }))
        .then((buffer) => {
          expect(buffer).to.deep.equal(Buffer.alloc(offset, 0))
        })
    })
  })

  runTest(({ type, path, content, contentSize }) => {
    it(`expands a file when an offset is specified (${type})`, () => {
      const offset = contentSize - 1
      const newContent = Buffer.from('Oh hai!')

      return mfs.write(path, content, {
        create: true
      })
        .then(() => mfs.write(path, newContent, {
          offset
        }))
        .then(() => mfs.stat(path))
        .then((stats) => expect(stats.size).to.equal(contentSize + newContent.length - 1))
        .then(() => mfs.read(path, {
          offset
        }))
        .then((buffer) => expect(buffer).to.deep.equal(newContent))
    })
  })

  runTest(({ type, path, content, contentSize }) => {
    it(`expands a file when an offset is specified and the offset is longer than the file (${type})`, () => {
      const offset = contentSize + 5
      const newContent = Buffer.from('Oh hai!')

      return mfs.write(path, content, {
        create: true
      })
        .then(() => mfs.write(path, newContent, {
          offset
        }))
        .then(() => mfs.stat(path))
        .then((stats) => expect(stats.size).to.equal(newContent.length + offset))
        .then(() => mfs.read(path, {
          offset: offset - 5
        }))
        .then((buffer) => {
          expect(buffer).to.deep.equal(Buffer.concat([Buffer.from([0, 0, 0, 0, 0]), newContent]))
        })
    })
  })

  runTest(({ type, path, content }) => {
    it(`truncates a file after writing (${type})`, () => {
      const newContent = Buffer.from('Oh hai!')

      return mfs.write(path, content, {
        create: true
      })
        .then(() => mfs.write(path, newContent, {
          truncate: true
        }))
        .then(() => mfs.stat(path))
        .then((stats) => expect(stats.size).to.equal(newContent.length))
        .then(() => mfs.read(path))
        .then((buffer) => expect(buffer).to.deep.equal(newContent))
    })
  })

  runTest(({ type, path, content }) => {
    it(`truncates a file after writing with a stream (${type})`, () => {
      const newContent = Buffer.from('Oh hai!')
      const stream = values([newContent])

      return mfs.write(path, content, {
        create: true
      })
        .then(() => mfs.write(path, stream, {
          truncate: true
        }))
        .then(() => mfs.stat(path))
        .then((stats) => expect(stats.size).to.equal(newContent.length))
        .then(() => mfs.read(path))
        .then((buffer) => expect(buffer).to.deep.equal(newContent))
    })
  })

  runTest(({ type, path, content }) => {
    it(`truncates a file after writing with a stream with an offset (${type})`, () => {
      const offset = 100
      const newContent = Buffer.from('Oh hai!')
      const stream = values([newContent])

      return mfs.write(path, content, {
        create: true
      })
        .then(() => mfs.write(path, stream, {
          truncate: true,
          offset
        }))
        .then(() => mfs.stat(path))
        .then((stats) => expect(stats.size).to.equal(offset + newContent.length))
    })
  })

  runTest(({ type, path, content }) => {
    it(`writes a file with raw blocks for newly created leaf nodes (${type})`, () => {
      return mfs.write(path, content, {
        create: true,
        rawLeaves: true
      })
        .then(() => mfs.stat(path))
        .then((stats) => collectLeafCids(mfs, stats.hash))
        .then((cids) => {
          const rawNodes = cids
            .filter(cid => cid.codec === 'raw')

          expect(rawNodes).to.not.be.empty()
        })
    })
  })

  it('supports concurrent writes', function () {
    const files = []

    for (let i = 0; i < 10; i++) {
      files.push({
        name: `source-file-${Math.random()}.txt`,
        source: bufferStream(100)
      })
    }

    return Promise.all(
      files.map(({ name, source }) => mfs.write(`/concurrent/${name}`, source, {
        create: true,
        parents: true
      }))
    )
      .then(() => mfs.ls('/concurrent'))
      .then(listing => {
        expect(listing.length).to.equal(files.length)

        listing.forEach(listedFile => {
          expect(files.find(file => file.name === listedFile.name))
        })
      })
  })

  it('rewrites really big files', function () {
    let expectedBytes = Buffer.alloc(0)
    let originalBytes = Buffer.alloc(0)
    const initialStream = bufferStream(1024 * 300, {
      collector: (bytes) => {
        originalBytes = Buffer.concat([originalBytes, bytes])
      }
    })
    const newDataStream = bufferStream(1024 * 300, {
      collector: (bytes) => {
        expectedBytes = Buffer.concat([expectedBytes, bytes])
      }
    })

    const fileName = `/rewrite/file-${Math.random()}.txt`

    return mfs.write(fileName, initialStream, {
      create: true,
      parents: true
    })
      .then(() => mfs.write(fileName, newDataStream, {
        offset: 0
      }))
      .then(() => mfs.read(fileName))
      .then(actualBytes => {
        for (var i = 0; i < expectedBytes.length; i++) {
          if (expectedBytes[i] !== actualBytes[i]) {
            if (originalBytes[i] === actualBytes[i]) {
              throw new Error(`Bytes at index ${i} were not overwritten - expected ${expectedBytes[i]} actual ${originalBytes[i]}`)
            }

            throw new Error(`Bytes at index ${i} not equal - expected ${expectedBytes[i]} actual ${actualBytes[i]}`)
          }
        }

        expect(actualBytes).to.deep.equal(expectedBytes)
      })
  })

  it('shards a large directory when writing too many links to it', async () => {
    const shardSplitThreshold = 10
    const dirPath = `/sharded-dir-${Math.random()}`
    const newFile = `file-${Math.random()}`
    const newFilePath = `/${dirPath}/${newFile}`

    await mfs.mkdir(dirPath, {
      shardSplitThreshold
    })

    for (let i = 0; i < shardSplitThreshold; i++) {
      await mfs.write(`/${dirPath}/file-${Math.random()}`, Buffer.from([0, 1, 2, 3]), {
        create: true,
        shardSplitThreshold
      })
    }

    expect((await mfs.stat(dirPath)).type).to.equal('directory')

    await mfs.write(newFilePath, Buffer.from([0, 1, 2, 3]), {
      create: true,
      shardSplitThreshold
    })

    expect((await mfs.stat(dirPath)).type).to.equal('hamt-sharded-directory')

    const files = await mfs.ls(dirPath, {
      long: true
    })

    // new file should be in directory
    expect(files.filter(file => file.name === newFile).pop()).to.be.ok()
  })

  it('writes a file to an already sharded directory', async () => {
    const shardedDirPath = await createShardedDirectory(mfs)

    const newFile = `file-${Math.random()}`
    const newFilePath = `${shardedDirPath}/${newFile}`

    await mfs.write(newFilePath, Buffer.from([0, 1, 2, 3]), {
      create: true
    })

    // should still be a sharded directory
    expect((await mfs.stat(shardedDirPath)).type).to.equal('hamt-sharded-directory')

    const files = await mfs.ls(shardedDirPath, {
      long: true
    })

    // new file should be in the directory
    expect(files.filter(file => file.name === newFile).pop()).to.be.ok()

    // should be able to ls new file directly
    expect(await mfs.ls(newFilePath, {
      long: true
    })).to.not.be.empty()
  })

  it('overwrites a file in a sharded directory when positions do not match', async () => {
    const shardedDirPath = await createShardedDirectory(mfs)
    const newFile = 'file-0.6944395883502592'
    const newFilePath = `${shardedDirPath}/${newFile}`
    const newContent = Buffer.from([3, 2, 1, 0])

    await mfs.write(newFilePath, Buffer.from([0, 1, 2, 3]), {
      create: true
    })

    // should still be a sharded directory
    expect((await mfs.stat(shardedDirPath)).type).to.equal('hamt-sharded-directory')

    // overwrite the file
    await mfs.write(newFilePath, newContent, {
      create: true
    })

    // read the file back
    expect(await mfs.read(newFilePath)).to.deep.equal(newContent)

    // should be able to ls new file directly
    expect(await mfs.ls(newFilePath, {
      long: true
    })).to.not.be.empty()
  })

  it('overwrites file in a sharded directory', async () => {
    const shardedDirPath = await createShardedDirectory(mfs)
    const newFile = `file-${Math.random()}`
    const newFilePath = `${shardedDirPath}/${newFile}`
    const newContent = Buffer.from([3, 2, 1, 0])

    await mfs.write(newFilePath, Buffer.from([0, 1, 2, 3]), {
      create: true
    })

    // should still be a sharded directory
    expect((await mfs.stat(shardedDirPath)).type).to.equal('hamt-sharded-directory')

    // overwrite the file
    await mfs.write(newFilePath, newContent, {
      create: true
    })

    // read the file back
    expect(await mfs.read(newFilePath)).to.deep.equal(newContent)

    // should be able to ls new file directly
    expect(await mfs.ls(newFilePath, {
      long: true
    })).to.not.be.empty()
  })

  it('overwrites a file in a subshard of a sharded directory', async () => {
    const shardedDirPath = await createShardedDirectory(mfs, 10, 75)
    const newFile = `file-1a.txt`
    const newFilePath = `${shardedDirPath}/${newFile}`
    const newContent = Buffer.from([3, 2, 1, 0])

    await mfs.write(newFilePath, Buffer.from([0, 1, 2, 3]), {
      create: true
    })

    // should still be a sharded directory
    expect((await mfs.stat(shardedDirPath)).type).to.equal('hamt-sharded-directory')

    // overwrite the file
    await mfs.write(newFilePath, newContent, {
      create: true
    })

    // read the file back
    expect(await mfs.read(newFilePath)).to.deep.equal(newContent)

    // should be able to ls new file directly
    expect(await mfs.ls(newFilePath, {
      long: true
    })).to.not.be.empty()
  })

  it('writes a file with a different CID version to the parent', async () => {
    const directory = `cid-versions-${Math.random()}`
    const directoryPath = `/${directory}`
    const fileName = `file-${Math.random()}.txt`
    const filePath = `${directoryPath}/${fileName}`
    const expectedBytes = Buffer.from([0, 1, 2, 3])

    await mfs.mkdir(directoryPath, {
      cidVersion: 0
    })

    expect((await cidAtPath(directoryPath, mfs)).version).to.equal(0)

    await mfs.write(filePath, expectedBytes, {
      create: true,
      cidVersion: 1
    })

    expect((await cidAtPath(filePath, mfs)).version).to.equal(1)

    const actualBytes = await mfs.read(filePath)

    expect(actualBytes).to.deep.equal(expectedBytes)
  })

  it('overwrites a file with a different CID version', async () => {
    const directory = `cid-versions-${Math.random()}`
    const directoryPath = `/${directory}`
    const fileName = `file-${Math.random()}.txt`
    const filePath = `${directoryPath}/${fileName}`
    const expectedBytes = Buffer.from([0, 1, 2, 3])

    await mfs.mkdir(directoryPath, {
      cidVersion: 0
    })

    expect((await cidAtPath(directoryPath, mfs)).version).to.equal(0)

    await mfs.write(filePath, Buffer.from([5, 6]), {
      create: true,
      cidVersion: 0
    })

    expect((await cidAtPath(filePath, mfs)).version).to.equal(0)

    await mfs.write(filePath, expectedBytes, {
      cidVersion: 1
    })

    expect((await cidAtPath(filePath, mfs)).version).to.equal(1)

    const actualBytes = await mfs.read(filePath)

    expect(actualBytes).to.deep.equal(expectedBytes)
  })

  it('partially overwrites a file with a different CID version', async () => {
    const directory = `cid-versions-${Math.random()}`
    const directoryPath = `/${directory}`
    const fileName = `file-${Math.random()}.txt`
    const filePath = `${directoryPath}/${fileName}`

    await mfs.mkdir(directoryPath, {
      cidVersion: 0
    })

    expect((await cidAtPath(directoryPath, mfs)).version).to.equal(0)

    await mfs.write(filePath, Buffer.from([5, 6, 7, 8, 9, 10, 11]), {
      create: true,
      cidVersion: 0
    })

    expect((await cidAtPath(filePath, mfs)).version).to.equal(0)

    await mfs.write(filePath, Buffer.from([0, 1, 2, 3]), {
      cidVersion: 1,
      offset: 1
    })

    expect((await cidAtPath(filePath, mfs)).version).to.equal(1)

    const actualBytes = await mfs.read(filePath)

    expect(actualBytes).to.deep.equal(Buffer.from([5, 0, 1, 2, 3, 10, 11]))
  })

  it('writes a file with a different hash function to the parent', async () => {
    const directory = `cid-versions-${Math.random()}`
    const directoryPath = `/${directory}`
    const fileName = `file-${Math.random()}.txt`
    const filePath = `${directoryPath}/${fileName}`
    const expectedBytes = Buffer.from([0, 1, 2, 3])

    await mfs.mkdir(directoryPath, {
      cidVersion: 0
    })

    expect((await cidAtPath(directoryPath, mfs)).version).to.equal(0)

    await mfs.write(filePath, expectedBytes, {
      create: true,
      cidVersion: 1,
      hashAlg: 'sha2-512'
    })

    expect(multihash.decode((await cidAtPath(filePath, mfs)).multihash).name).to.equal('sha2-512')

    const actualBytes = await mfs.read(filePath)

    expect(actualBytes).to.deep.equal(expectedBytes)
  })

  it('results in the same hash as a sharded directory created by the importer when adding a new file', async function () {
    this.timeout(60000)

    const {
      nextFile,
      dirWithAllFiles,
      dirWithSomeFiles,
      dirPath
    } = await createTwoShards(mfs, 75)

    await mfs.cp(`/ipfs/${dirWithSomeFiles.toBaseEncodedString()}`, dirPath)

    await mfs.write(nextFile.path, nextFile.content, {
      create: true
    })

    const stats = await mfs.stat(dirPath)
    const updatedDirCid = new CID(stats.hash)

    expect(stats.type).to.equal('hamt-sharded-directory')
    expect(updatedDirCid.toBaseEncodedString()).to.deep.equal(dirWithAllFiles.toBaseEncodedString())
  })

  it('results in the same hash as a sharded directory created by the importer when creating a new subshard', async function () {
    this.timeout(60000)

    const {
      nextFile,
      dirWithAllFiles,
      dirWithSomeFiles,
      dirPath
    } = await createTwoShards(mfs, 100)

    await mfs.cp(`/ipfs/${dirWithSomeFiles.toBaseEncodedString()}`, dirPath)

    await mfs.write(nextFile.path, nextFile.content, {
      create: true
    })

    const stats = await mfs.stat(dirPath)
    const updatedDirCid = new CID(stats.hash)

    expect(updatedDirCid.toBaseEncodedString()).to.deep.equal(dirWithAllFiles.toBaseEncodedString())
  })

  it('results in the same hash as a sharded directory created by the importer when adding a file to a subshard', async function () {
    this.timeout(60000)

    const {
      nextFile,
      dirWithAllFiles,
      dirWithSomeFiles,
      dirPath
    } = await createTwoShards(mfs, 82)

    await mfs.cp(`/ipfs/${dirWithSomeFiles.toBaseEncodedString()}`, dirPath)

    await mfs.write(nextFile.path, nextFile.content, {
      create: true
    })

    const stats = await mfs.stat(dirPath)
    const updatedDirCid = new CID(stats.hash)

    expect(stats.type).to.equal('hamt-sharded-directory')
    expect(updatedDirCid.toBaseEncodedString()).to.deep.equal(dirWithAllFiles.toBaseEncodedString())
  })

  it('results in the same hash as a sharded directory created by the importer when adding a file to a subshard of a subshard', async function () {
    this.timeout(60000)

    const {
      nextFile,
      dirWithAllFiles,
      dirWithSomeFiles,
      dirPath
    } = await createTwoShards(mfs, 2187)

    await mfs.cp(`/ipfs/${dirWithSomeFiles.toBaseEncodedString()}`, dirPath)

    await mfs.write(nextFile.path, nextFile.content, {
      create: true
    })

    const stats = await mfs.stat(dirPath)
    const updatedDirCid = new CID(stats.hash)

    expect(stats.type).to.equal('hamt-sharded-directory')
    expect(updatedDirCid.toBaseEncodedString()).to.deep.equal(dirWithAllFiles.toBaseEncodedString())
  })
})