const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok', uptime: process.uptime() }, message: '' });
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/categories', require('./routes/category.routes'));
app.use('/api/transactions', require('./routes/transaction.routes'));
app.use('/api/agent', require('./routes/agent.routes'));
app.use('/api/tax', require('./routes/tax.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/receipts', require('./routes/receipt.routes'));
app.use('/api/deadlines', require('./routes/deadline.routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
