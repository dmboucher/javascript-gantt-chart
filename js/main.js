/****************************************************************************/
/* Page Event Handlers                                                      */
/****************************************************************************/

let ganttChart; // global variable to store the GanttChart object
function onLoad() {
	fetch('assets/data/raw_data.json')
		.then(response => response.json())
		.then(data => {
			ganttChart = new GanttChart({
				"id": "ganttChart",
				"data": data,
			});
			ganttChart.Init();
		})
		.catch(error => console.error('Error loading data:', error));
}

/****************************************************************************/
/* Date Utilities                                                           */
/****************************************************************************/

function GetDateWithoutTime(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function GetDateString(date, leadingZero = false) {
	let   month = date.getMonth() + 1;
	let   day   = date.getDate();
	const year  = date.getFullYear();
	if (leadingZero) month = month.toString().padStart(2,"0");
	if (leadingZero) day   =   day.toString().padStart(2,"0");
	return `${month}/${day}/${year}`;
}

function GetDateDifferenceInDays(sourceDate, compareDate) {

	// Create new Date objects to prevent modifying the original dates.
	const sourceDateCopy  = new Date(sourceDate.getTime() );
	const compareDateCopy = new Date(compareDate.getTime());

	// Set both dates to midnight to ignore the time of day.
	sourceDateCopy.setHours( 0, 0, 0, 0);
	compareDateCopy.setHours(0, 0, 0, 0);

	// Calculate the difference (in milliseconds), then convert the difference to days and round to the nearest whole number.
	const timeDiff = compareDateCopy.getTime() - sourceDateCopy.getTime();
	return Math.round(timeDiff / (1000 * 60 * 60 * 24)); // 1000 milliseconds * 60 seconds * 60 minutes * 24 hours = 86,400,000 milliseconds in a day
}

function AddToDate(date, type, units) {
	let result = new Date(date);
	switch (type) {
		case "years":
			result.setFullYear(result.getFullYear() + units);
			break;
		case "months":
			result.setMonth(   result.getMonth()    + units);
			break;
		case "weeks":
			result.setDate(    result.getDate()     + (units * 7));
			break;
		case "days":
			result.setDate(    result.getDate()     + units);
			break;
		case "hours":
			result.setHours(   result.getHours()    + units);
			break;
		case "minutes":
			result.setMinutes( result.getMinutes()  + units);
			break;
		case "seconds":
			result.setSeconds( result.getSeconds()  + units);
			break;
		default:
			throw new Error(`AddToDate() - Unknown date type: ${type}`);
	}
	return result;
}

function DateIsToday(date) {
	const today = new Date();
	return ( // check if the provided date has the same year, month, and day as today
		date.getFullYear() === today.getFullYear() &&
		date.getMonth()    === today.getMonth()    &&
		date.getDate()     === today.getDate()
	);
}

function GetWeekdayCodeString(date) {
	const weekday = ["U", "M", "T", "W", "R", "F", "S"];
	return weekday[date.getDay()];
}

function GetWeekdayString(date, short = false) {
	const weekday      = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const weekdayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	if (short) return weekdayShort[date.getDay()];
	return weekday[date.getDay()];
}

function GetMonthString(date, short = false) {
	const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const monthLong  = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	return short ? monthShort[date.getMonth()] : monthLong[date.getMonth()];
}