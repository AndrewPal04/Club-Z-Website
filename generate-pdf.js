const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

async function generatePDFBuffer() {
  const templatePath = path.join(__dirname, 'Tutor Time Summary Template 0723.pdf');
  const pdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 12;

  const tutorData = JSON.parse(fs.readFileSync('currentSession.json'));
  const students = JSON.parse(fs.readFileSync('students.json'));

  page.drawText(tutorData.tutorName, { x: 140, y: 620, size: fontSize, font });
  page.drawText(tutorData.month, { x: 400, y: 620, size: fontSize, font });

  let y = 530;
  let totaliPHours = 0;
  let totalOHours = 0;

  students.slice(0, 12).forEach(student => {
    const { name, inPersonHours, onlineHours } = student;
    page.drawText(name, { x: 80, y, size: fontSize, font });
    page.drawText(inPersonHours.toString(), { x: 430, y, size: fontSize, font });
    page.drawText(onlineHours.toString(), { x: 510, y, size: fontSize, font });
    totaliPHours += Number(inPersonHours);
    totalOHours += Number(onlineHours);
    y -= 29;
  });

  page.drawText(totaliPHours.toString(), { x: 430, y: 190, size: fontSize, font });
  page.drawText(totalOHours.toString(), { x: 510, y: 190, size: fontSize, font });

  const finalPdf = await pdfDoc.save();
  return finalPdf; // return the PDF as a buffer
}

module.exports = generatePDFBuffer;
