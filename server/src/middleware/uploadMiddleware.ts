import multer from 'multer';
import path from 'path';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.storage.uploadDir);
  },
  filename: (_req, file, cb) => {
    // multer 在 Windows 上默认用 latin1 编码文件名，需要转为 UTF-8
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf-8');
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('仅支持 PDF 文件'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.storage.maxFileSize,
  },
});
