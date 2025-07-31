const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

function formatTime(time) {
  if (!time) return '';
  let [hour, minute] = time.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${minute.toString().padStart(2, '0')} ${suffix}`;
}

function wrapWords(text, maxChars) {
  const paragraphs = text.split(/\r?\n/);
  const lines = [];

  paragraphs.forEach(paragraph => {
    const words = paragraph.split(' ');
    let line = '';

    words.forEach(word => {
      if ((line + word).length > maxChars) {
        lines.push(line.trim());
        line = '';
      }
      line += word + ' ';
    });

    if (line.trim()) lines.push(line.trim());
  });

  return lines;
}

async function generateAttendancePDF() {
  const templatePath = path.join(__dirname, 'Student Attendance Sheet TEMPLATE.pdf');
  const outputPath = path.join(__dirname, 'public', 'Student_Attendance_Sheet.pdf');
  const pdfDoc = await PDFDocument.load(fs.readFileSync(templatePath));
  const page = pdfDoc.getPages()[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;

  const info = JSON.parse(fs.readFileSync('currentAttendance.json'));
  const sessions = JSON.parse(fs.readFileSync('attendanceEntries.json'));
  const counts = JSON.parse(fs.readFileSync('attendanceCounts.json'));
  const extra = JSON.parse(fs.readFileSync('attendanceExtra.json'));

  page.drawText(info.studentName, { x: 120, y: 690, size: fontSize, font });
  page.drawText(info.tutorName, { x: 300, y: 690, size: fontSize, font });
  page.drawText(info.month, { x: 490, y: 690, size: fontSize, font });
  page.drawText(info.subjects, { x: 120, y: 665, size: fontSize, font });
  page.drawText(info.grade, { x: 300, y: 665, size: fontSize, font });

  const rowY = [558, 528, 499, 470, 441, 411, 382, 353, 313, 294, 264, 234];

  sessions.slice(0, 12).forEach((session, i) => {
    const y = rowY[i];

    page.drawText(session.date, { x: 20, y, size: fontSize, font });
    page.drawText(formatTime(session.start), { x: 65, y, size: fontSize, font });
    page.drawText(formatTime(session.end), { x: 130, y, size: fontSize, font });

    const lines = wrapWords(session.comments, 41).slice(0, 2);
    lines.forEach((line, j) => {
      page.drawText(line, {
        x: 185,
        y: y + 17 - j * 12,
        size: fontSize,
        font
      });
    });

    if (session.online) {
      page.drawText('X', { x: 582, y: y + 5, size: fontSize + 3, font });
    }
  });

  const progress = (extra.monthlyProgress || '').slice(0, 400);
  const progressLines = wrapWords(progress, 100);
  let progressY = 170;
  progressLines.forEach(line => {
    page.drawText(line, { x: 60, y: progressY, size: fontSize, font });
    progressY -= 20;
  });

  const [rYear, rMonth, rDay] = extra.reviewDate.split('-');
  const formattedReviewDate = `${rMonth}/${rDay}/${rYear}`;
  page.drawText(formattedReviewDate, { x: 300, y: 80, size: fontSize, font });

  page.drawText(`${counts.onlineCount}`, { x: 500, y: 210, size: fontSize, font });
  page.drawText(`${counts.inPersonCount}`, { x: 360, y: 210, size: fontSize, font });

  fs.writeFileSync(outputPath, await pdfDoc.save());
  console.log(`✅ Attendance PDF generated at: ${outputPath}`);
  return outputPath;
}

module.exports = generateAttendancePDF;
