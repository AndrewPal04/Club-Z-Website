const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function generatePDF() {
  const templatePath = path.join(__dirname, 'Tutor Time Summary Template 0723.pdf');
  const outputPath = path.join(os.homedir(), 'Downloads', 'Tutor_Time_Summary.pdf');

  const pdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];
  const { width } = page.getSize();

  const tutorData = JSON.parse(fs.readFileSync('currentSession.json'));
  const students = JSON.parse(fs.readFileSync('students.json'));

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 12;

  // Add Tutor name and Month
  page.drawText(tutorData.tutorName, {
    x: 140,
    y: 620,
    size: fontSize,
    font
  });

  page.drawText(tutorData.month, {
    x: 400,
    y: 620,
    size: fontSize,
    font
  });

  // Student data starts around y=620 and moves down ~40 per entry
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

  //Draw In Person Total
  page.drawText(totaliPHours.toString(),{
    x: 430,
    y: 190,
    size: fontSize,
    font
  })
  // Draw Online Total
  page.drawText(totalOHours.toString(), {
    x: 510,
    y: 190,
    size: fontSize,
    font
  });

  const finalPdf = await pdfDoc.save();
  fs.writeFileSync(outputPath, finalPdf);

  console.log(`✅ PDF generated at: ${outputPath}`);
}

module.exports = generatePDF;
