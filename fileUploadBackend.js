const express = require('express');
const app = express();
const port = 3000;
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

app.use(cors());

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads')
    },
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
    }
});

const upload = multer({ storage: storage });

app.post('/upload', upload.single('file'), (req, res) => {
    console.log(req.file);
    /*
    {   
        fieldname: 'file',
        originalname: '1.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        destination: './uploads',
        filename: 'file-1575606532817.pdf',
        path: 'uploads\\file-1575606532817.pdf',
        size: 222613 
    }
     */
    console.log('storage location is ', req.hostname +'/' + req.file.path);
    res.send(req.file);
});

app.listen(port, () => console.log(`File Upload Backend is listening on port ${port}!`));
//https://medium.com/quick-code/uploading-files-and-serve-directory-listing-using-nodejs-6f353f65be5