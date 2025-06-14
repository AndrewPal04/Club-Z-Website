const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function formatTime(time) {
  if (!time) return '';
  let [hour, minute] = time.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${minute.toString().padStart(2, '0')} ${suffix}`;
}

async function generateAttendancePDF() {
  const templatePath = path.join(__dirname, 'Student Attendance Sheet TEMPLATE.pdf');
  const outputPath = path.join(__dirname, 'public', 'Student_Attendance_Sheet.pdf');

  const pdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;

  const info = JSON.parse(fs.readFileSync('currentAttendance.json'));
  const sessions = JSON.parse(fs.readFileSync('attendanceEntries.json'));

  // Header
  page.drawText(info.studentName, { x: 120, y: 690, size: fontSize, font });
  page.drawText(info.tutorName, { x: 300, y: 690, size: fontSize, font });
  page.drawText(info.month, { x: 490, y: 690, size: fontSize, font });
  page.drawText(info.subjects, { x: 120, y: 665, size: fontSize, font });
  page.drawText(info.grade, { x: 300, y: 665, size: fontSize, font });

  let y = 560;

  sessions.slice(0, 12).forEach(session => {
    page.drawText(session.date, { x: 20, y, size: fontSize, font });
    page.drawText(formatTime(session.start), { x: 65, y, size: fontSize, font });
    page.drawText(formatTime(session.end), { x: 130, y, size: fontSize, font });

    const maxCharsPerLine = 45;
    const commentLine1 = session.comments.slice(0, maxCharsPerLine);
    const commentLine2 = session.comments.slice(maxCharsPerLine, maxCharsPerLine * 2);

    page.drawText(commentLine1, { x: 185, y, size: fontSize, font });
    if (commentLine2) {
      page.drawText(commentLine2, { x: 185, y: y - 12, size: fontSize, font });
    }

    if (session.online) {
      page.drawText('X', { x: 582, y: y + 2, size: fontSize + 3, font });
    }

    y -= commentLine2 ? 29 + 12 : 29;
  });

  const pdfBytesFinal = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytesFinal);

  console.log(`✅ Attendance PDF generated at: ${outputPath}`);
  return outputPath;
}

module.exports = generateAttendancePDF;
