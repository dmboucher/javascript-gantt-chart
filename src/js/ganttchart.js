/*******************************************************************************/
//#region GanttChart Class
//
//    This class contains all data and code needed to properly render a gantt chart.
//
// Constructor Parameters:
//    Required:
//       id   - string - the id of the container into which this instance of the gantt chart will be rendered - must be unique on the page
//       data - JSON   - the JSON data needed to render the gantt chart
//
// Public Methods Available:
//    Init()               - Creates the gantt chart and renders it into the div with the provided id
//    ToggleRowExpansion() - Expands or collapses a single section by toggling its visibility
//    ExpandAllSections()  - Expands or collapses all sections
//    Zoom()               - Increases or decreases the zoom level
//
/*******************************************************************************/

class GanttChart {

	/****************************************************************************/
	//#region Private Properties                                                */
	/****************************************************************************/

	// Primary properties.
	#id   = null;
	#data = [];

	// Properties needed for container sizing/resizing.
	#resizing  = false;
	#moved     = false;
	#zoomLevel = 0;

	// Properties needed for processing chart data.
	#minChartDate   = {};
	#maxChartDate   = {};
	#numChartDays   = 0;
	#chartDays      = [];
	#daysUntilToday = -1;
	#dayWidth       = 0;

	// Properties needed for data grid column sizing.
	#columnWidths = {
		id  : 35,
		name: 230,
		date: 90
	};

	// Other properties.
	#timer = null; // prevents the grid from refreshing too quickly whenever viewport resize events happen

	//#endregion


	/****************************************************************************/
	//#region Constructor                                                       */
	/****************************************************************************/

	constructor({ id, data }) {

		// Store the constructor values.
		this.#id   = id;
		this.#data = data;

		// Process the data.
		this.#ProcessData();
	}

	//#endregion


	/****************************************************************************/
	//#region Public Getters                                                    */
	/****************************************************************************/

	get id() {
		return this.#id;
	}

	//#endregion


	/****************************************************************************/
	//#region Public Setters                                                    */
	/****************************************************************************/

	set zoomLevel(zoomLevel) {
		this.#zoomLevel = zoomLevel;
	}

	//#endregion


	/****************************************************************************/
	//#region Data Processing Methods                                           */
	/****************************************************************************/

	#ProcessData() {

		// Validation.
		if (this.#data.length === 0) { // nothing to process
			this.#minChartDate = {};
			this.#maxChartDate = {};
			return;
		}

		// Init.
		let minStart =  Infinity;
		let maxEnd   = -Infinity;

		// Iterate through data to find minStart and maxEnd.
		// We also add several convenience date objects for improved performance downstream.
		this.#data.forEach(item => {
			if (item.start < minStart) minStart = item.start;
			if (item.end   > maxEnd  ) maxEnd   = item.end;
			item.startDate    = GetDateWithoutTime(new Date(item.start));
			item.endDate      = GetDateWithoutTime(new Date(item.end  ));
			item.startStr     = GetDateString(item.startDate, true);
			item.endStr       = GetDateString(item.endDate  , true);
			item.startStrTrim = GetDateString(item.startDate);
			item.endStrTrim   = GetDateString(item.endDate  );
			item.durationDays = GetDateDifferenceInDays(item.startDate, item.endDate);
		});
		if (!isFinite(minStart) || !isFinite(maxEnd)) return; // we're missing a start or an end

		// Set the day before the earliest start and the day after the latest end.
		const minDate = AddToDate(GetDateWithoutTime(new Date(minStart)), "days", -1);
		const maxDate = AddToDate(GetDateWithoutTime(new Date(maxEnd  )), "days",  1);
		this.#minChartDate = { date: minDate, epoch: minDate.getTime() };
		this.#maxChartDate = { date: maxDate, epoch: maxDate.getTime() };

		// Iterate again so we can add the number of days from the beginning of the chart to the start of the point/bar - needed for calculating horizontal offsets.
		this.#data.forEach(item => {
			item.daysToStart = GetDateDifferenceInDays(this.#minChartDate.date, item.startDate);
		});

		// Calculate the total number of days in the range.
		this.#numChartDays = GetDateDifferenceInDays(this.#minChartDate.date, this.#maxChartDate.date) + 1; // plus 1 to make the range inclusive

		// Load up chart days array with needed data.
		this.#chartDays = [];
		for (let i = 0; i < this.#numChartDays; i++) {
			const date = AddToDate(this.#minChartDate.date, "days", i);
			if (DateIsToday(date)) this.#daysUntilToday = i;
			this.#chartDays.push({
				date        : date,
				epoch       : date.getTime(),
				day         : date.getDate(),
				weekdayCode : GetWeekdayCodeString(date),
				weekdayShort: GetWeekdayString(date, true),
				weekdayLong : GetWeekdayString(date),
				dateString  : GetDateString(date),
				monthLong   : GetMonthString(date),
				monthShort  : GetMonthString(date, true),
				year        : date.getFullYear()
			});
		}
	}

	//#endregion


	/****************************************************************************/
	//#region Grid Building Methods                                             */
	/****************************************************************************/

	#RefreshGrid() {
		this.#BuildElements();
		this.#SizeContainers();
		this.#AddConnectors();
		this.#AddEventHandlers();
		this.#StyleControlIcons();
	}

	#BuildElements() {
		let   container     = document.getElementById(this.id);
		const widths        = this.#DefaultDivWidths();
		container.innerHTML = `
			<div id="${this.id}_left" class="gantt_side gantt_left" style="width: ${widths.left}px">
				<div id="${this.id}_grid_header" class="rows_header rows_grid_header">
					${this.#AddHeadersDataGrid()}
				</div>
				<div id="${this.id}_grid" class="rows_grid scrollable_container">
					${this.#AddRowsDataGrid()}
				</div>
			</div>
			<div id="${this.id}_splitter" class="splitter" title="Drag to reposition.\nClick to reset." style="width: ${widths.splitter}px"></div>
			<div id="${this.id}_right" class="gantt_side gantt_right" style="width: ${widths.right}px">
				<div id="${this.id}_chart_header" class="rows_header rows_chart_header">
					${this.#AddHeadersGanttChart()}
				</div>
				<div id="${this.id}_chart" class="rows_chart scrollable_container">
					${this.#AddRowsGanttChart()}
				</div>
			</div>`;
	}

	#DefaultDivWidths() {
		let   container    = document.getElementById(this.id);
		const size         = container.getBoundingClientRect();
		const splitter     = 7;
		const gridRowWidth = this.#columnWidths.id + this.#columnWidths.name + (this.#columnWidths.date * 2);
		const left         = gridRowWidth; // this code would make the left pane 25% of the viewport width:  Math.round(size.width * 0.25);
		const right        = size.width - left - splitter;
		return { splitter, left, right };
	}

	#SizeContainers() { // these explicit widths need to be set to ensure proper scrolling behavior

		// Calculate Zoom Levels.
		const widths   = this.#DefaultDivWidths();                                                                // grab the default div widths
		this.#dayWidth = (widths.right - this.#GetVerticalScrollBarWidth()) / this.#numChartDays;                 // calculate the default day width
		if (this.#dayWidth < 10) this.#dayWidth = 10;                                                             // don't allow day widths less than 10 pixels - we need to be able to see single day bars
		if (0 < this.#zoomLevel) this.#dayWidth = this.#zoomLevel === 1 ? 30 : (this.#zoomLevel === 2 ? 60 : 90); // update the day width if user has zoomed in

		// Grid widths.
		const gridRowWidth  = this.#columnWidths.id + this.#columnWidths.name + (this.#columnWidths.date * 2);
		document.getElementById(`${this.id}_header_grid_row`).style.width = `${gridRowWidth}px`;
		document.querySelectorAll(".gantt_chart .gantt_grid_row"                       ).forEach(row  => { row.style.width  = `${gridRowWidth           }px`; });
		document.querySelectorAll(".gantt_chart .gantt_grid_row .gantt_cell.gantt_id"  ).forEach(cell => { cell.style.width = `${this.#columnWidths.id  }px`; });
		document.querySelectorAll(".gantt_chart .gantt_grid_row .gantt_cell.gantt_name").forEach(cell => { cell.style.width = `${this.#columnWidths.name}px`; });
		document.querySelectorAll(".gantt_chart .gantt_grid_row .gantt_cell.gantt_date").forEach(cell => { cell.style.width = `${this.#columnWidths.date}px`; });

		// Chart widths.
		const chartRowWidth = this.#dayWidth * this.#numChartDays;
		document.querySelectorAll(".gantt_chart .gantt_chart_row_header"            ).forEach(row  => { row.style.width  = `${chartRowWidth }px`; });
		document.querySelectorAll(".gantt_chart .gantt_chart_row"                   ).forEach(row  => { row.style.width  = `${chartRowWidth }px`; });
		document.querySelectorAll(".gantt_chart .gantt_chart_row_header .gantt_cell").forEach(cell => { cell.style.width = `${this.#dayWidth}px`; });
		document.querySelectorAll(".gantt_chart .gantt_chart_row        .gantt_cell").forEach(cell => { cell.style.width = `${this.#dayWidth}px`; });

		// Chart day widths and horizontal offsets.
		this.#data.forEach(point => {
			let bar = document.getElementById(`${this.id}_${point.id}_bar`);
			if (bar) {
				bar.style.width = `${this.#dayWidth * point.durationDays}px`;
				bar.style.left  = `${this.#dayWidth * point.daysToStart}px`;
			}
		});

		// Today line.
		if (0 <= this.#daysUntilToday) {
			let today = document.getElementById(`${this.id}_today`);
			if (today) {
				today.style.height = `${document.getElementById(`${this.id}_chart`).scrollHeight}px`;
				today.style.left   = `${this.#dayWidth * this.#daysUntilToday}px`;
			}
		}

		// Connector container.
		let connectorContainer = document.getElementById(`${this.id}_connector_container`);
		if (connectorContainer) {
			connectorContainer.style.height = `${document.getElementById(`${this.id}_chart`).scrollHeight}px`;
			connectorContainer.style.width  = `${this.#dayWidth * this.#numChartDays}px`;
		}
	}

	#AddHeadersDataGrid() {
		return `<div id="${this.id}_header_grid_row" class="gantt_grid_row">
				<div class="gantt_cell gantt_id"  >#</div>
				<div class="gantt_cell gantt_name">Task</div>
				<div class="gantt_cell gantt_date">Start</div>
				<div class="gantt_cell gantt_date">End</div>
			</div>`;
	}

	#AddRowsDataGrid() {
		let row = "";
		this.#data.forEach(point => {
			const title       = `${point.name}\nStart: ${point.startStrTrim}\nEnd: ${point.endStrTrim}`;
			const isParent    = (point.hasOwnProperty("parent") && point.parent !== null) ? false : true;
			const parentClass = isParent ? "" : `${this.id}_parent_id_${point.parent} expanded`;
			const rowHandler  = isParent ? `onclick="${this.id}.ToggleRowExpansion('${point.id}')"` : "";
			const typeStyle   = isParent ? "is_parent" : "is_child";
			const toggleDiv   = isParent ? `<div id="${this.id}_${point.id}_row_toggle">${this.#GetCaret()}</div>` : "";
			row += `<div id="${this.id}_${point.id}_grid_row" class="gantt_row gantt_grid_row ${this.id}_${point.id}_row ${parentClass}" title="${title}">
					<div class="gantt_cell gantt_id">${point.id}</div>
					<div class="gantt_cell gantt_name ${typeStyle}" ${rowHandler}>${toggleDiv}<div id="${this.id}_row_name" class="row_name">${point.name}</div></div>
					<div class="gantt_cell gantt_date">${point.startStr}</div>
					<div class="gantt_cell gantt_date">${point.endStr}</div>
				</div>`;
		});
		return `${row}<div class="gantt_row"></div>`; // an extra, empty row is needed when one side has a horizontal scrollbar and the other side doesn't - in that case, without the extra row, the scrollbar obstructs the bottom row
	}

	#GetCaret(down = true) {
		return `<svg><use href="assets/data/ico.svg#caret-${down ? "down" : "right"}"></use></svg>`;
	}

	#AddHeadersGanttChart() {

		// Init.
		const borderStyle = "1px solid rgb(176, 176, 176)";
		let   topRow      = `<div id="${this.id}_header_chart_row_top"   class="gantt_chart_row_header">`;
		let   bottomRow   = `<div id="${this.id}_header_chart_row_botom" class="gantt_chart_row_header">`;

		// Iterate the days of the chart.
		this.#chartDays.forEach(day => {

			// Set default values that work for most zoom levels.
			let showTopDate    = AddToDate(day.date, "days", 1) < this.#maxChartDate.date; // we need to have at least 2 days left in the chart to have room to display the week
			let showBottomDate = true;
			let topLeft        = day.epoch === this.#minChartDate.epoch || day.weekdayCode === "U";
			let topRight       = day.epoch === this.#maxChartDate.epoch;
			let bottomLeft     = true;
			let bottomRight    = day.epoch === this.#maxChartDate.epoch;
			let topBorder      = (topLeft    || topRight   ) ? (`style="${topLeft    ? `border-left: ${borderStyle}; ` : ""} ${topRight    ? `border-right: ${borderStyle}` : ""}"`) : "";
			let bottomBorder   = (bottomLeft || bottomRight) ? (`style="${bottomLeft ? `border-left: ${borderStyle}; ` : ""} ${bottomRight ? `border-right: ${borderStyle}` : ""}"`) : "";

			// Overwrite values as needed based on zoom level.
			switch (this.#zoomLevel) {
				case 1:
					showTopDate = AddToDate(day.date, "days", 2) < this.#maxChartDate.date; // we need to have at least 3 days left in the chart to have room to display the week
					topRow     += `<div class="gantt_cell" ${topBorder   }>${showTopDate && day.weekdayCode === "U" ? `${day.monthShort} ${day.day}, ${day.year}` : ""}</div>`;
					bottomRow  += `<div class="gantt_cell center" ${bottomBorder}>${showBottomDate ? `${day.weekdayCode === "U" ? "S" : day.weekdayCode}` : ""}</div>`;
					break;

				case 2:
					topRow     += `<div class="gantt_cell" ${topBorder   }>${showTopDate && day.weekdayCode === "U" ? `${day.monthLong} ${day.day}, ${day.year}` : ""}</div>`;
					bottomRow  += `<div class="gantt_cell center" ${bottomBorder}>${showBottomDate ? `${day.weekdayShort}` : ""}</div>`;
					break;

				case 3:
					topRow     += `<div class="gantt_cell" ${topBorder   }>${showTopDate && day.weekdayCode === "U" ? `${day.monthLong} ${day.day}, ${day.year}` : ""}</div>`;
					bottomRow  += `<div class="gantt_cell center" ${bottomBorder}>${showBottomDate ? `${day.weekdayLong}` : ""}</div>`;
					break;

				default:
					showTopDate    = new Date(day.date.getFullYear(), day.date.getMonth(), 10) < this.#maxChartDate.date; // we need to have at least 10 days     left in the chart to have room to display the month
					showBottomDate = AddToDate(day.date, "days", 7)                            < this.#maxChartDate.date; // we need to have at least a full week left in the chart to have room to display the week
					topLeft        = day.epoch === this.#minChartDate.epoch || day.day === 1;
					bottomLeft     = day.epoch === this.#minChartDate.epoch || day.weekdayCode === "U";
					topBorder      = (topLeft    || topRight   ) ? (`style="${topLeft    ? `border-left: ${borderStyle}; ` : ""} ${topRight    ? `border-right: ${borderStyle}` : ""}"`) : "";
					bottomBorder   = (bottomLeft || bottomRight) ? (`style="${bottomLeft ? `border-left: ${borderStyle}; ` : ""} ${bottomRight ? `border-right: ${borderStyle}` : ""}"`) : "";
					topRow        += `<div class="gantt_cell" ${topBorder   }>${showTopDate    && day.day         === 1   ? `${day.monthLong} ${day.year}` : ""}</div>`;
					bottomRow     += `<div class="gantt_cell" ${bottomBorder}>${showBottomDate && day.weekdayCode === "U" ? `${day.day} ${day.monthShort}` : ""}</div>`;
			}
		});
		topRow    += "</div>";
		bottomRow += "</div>";
		return `${topRow}${bottomRow}`;
	}

	#AddRowsGanttChart() {
		const borderStyle = "1px solid rgb(176, 176, 176)";
		const backColor   = "rgb(248, 248, 248)";
		let   row         = "";
		this.#data.forEach((point, index) => {
			const isParent    = (point.hasOwnProperty("parent") && point.parent !== null) ? false : true;
			const parentClass = isParent ? "" : `${this.id}_parent_id_${point.parent} expanded`;
			row += `<div id="${this.id}_${point.id}_chart_row" class="gantt_row gantt_chart_row ${this.id}_${point.id}_row ${parentClass}">`;
			this.#chartDays.forEach(day => {
				const back    = ["U", "S"].includes(day.weekdayCode);
				const isFirst = day.epoch === this.#minChartDate.epoch;
				const isLast  = day.epoch === this.#maxChartDate.epoch;
				const style   = (back || isFirst || isLast) ? (`style="${back ? `background-color: ${backColor}; ` : ""} ${isFirst ? `border-left: ${borderStyle}; ` : ""} ${isLast ? `border-right: ${borderStyle}` : ""}"`) : "";
				row += `<div class="gantt_cell" ${style}>`;
				if (isFirst) {
					row += this.#AddBar(point);
					if (index === 0) {
						row += `<div id="${this.id}_today" class="is_today" style="height: 0"></div>`; // default to 0 hight so it's not visible - we will only increase the height and properly position the line if appropriate (see this.#SizeContainers())
						row += `
							<svg id="${this.id}_connector_container" class="connector_container">
								<defs>
									<marker id="arrowhead" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto">
										<path d="M0,0 L10,5 L0,10 L2,5 Z" fill="rgb(100, 100, 100)" />
									</marker>
								</defs>
							</svg>`;
					}
				}
				row += "</div>"; // this adds the bar to the first cell in the row - we will position it horizontally as appropriate
			});
			row += `</div>`;
		});
		return `${row}<div class="gantt_row"></div>`; // an extra, empty row is needed when one side has a horizontal scrollbar and the other side doesn't - in that case, without the extra row, the scrollbar obstructs the bottom row
	}

	#AddBar(point) {
		const parentStyle = (point.hasOwnProperty("parent") && point.parent !== null) ? "" : "is_parent";
		const title       = `${point.name}\nStart: ${point.startStrTrim}\nEnd: ${point.endStrTrim}`;
		return `<div id="${this.id}_${point.id}_bar" class="gantt_bar ${parentStyle}" title="${title}" data-completed="${point.completed}%"></div>`;
	}

	#AddEventHandlers() {

		// Splitter events for resizing the left and right windows.
		document.getElementById(`${this.id}_splitter`).addEventListener("mousedown", (e) => { // these arrow functions allow "this" to refer to this class instance inside the handler
			this.#resizing = true;
			document.addEventListener("mousemove", this.#SplitterMouseMoveHandler);
			document.addEventListener("mouseup"  , this.#SplitterMouseUpHandler  );
		});

		// Row hover events.
		document.querySelectorAll(".gantt_chart .gantt_row").forEach(row => {
			row.addEventListener("mouseenter", (e) => { this.#UpdateRowStyle(e.target.id       ); });
			row.addEventListener("mouseleave", (e) => { this.#UpdateRowStyle(e.target.id, false); });
		});

		// Scroll events.
		document.querySelectorAll(".gantt_chart .scrollable_container").forEach(container => {
			container.addEventListener("scroll", (e) => { this.#SynchronizeScroll(e.target) });
		});
		document.getElementById(`${this.id}_grid`).addEventListener("wheel", (e) => { // updating the chart and syncing back to the grid is much smoother and more stable than updating the grid and trying to get the chart div to match
			let chartControl = document.getElementById(`${this.id}_chart`);           // grab the chart div
			chartControl.scrollTop += e.deltaY;                                       // apply the grid div mouse wheel delta to the chart div
			this.#SynchronizeScroll(chartControl);                                    // use the Sync function to update the grid div
		});

		// Bar events (i.e. dragging and dropping or resizing) could go here if needed.
	}

	#UpdateRowStyle(id, adding = true) {
		const className = id.replace(/_grid_row|_chart_row$/, "") + "_row";
		adding  ? document.querySelectorAll(`.${className}`).forEach(element => { element.classList.add(   "over") })
				: document.querySelectorAll(`.${className}`).forEach(element => { element.classList.remove("over") });
	}

	#StyleControlIcons() {
		document.querySelectorAll(".gantt_headerbar .controls .zoom").forEach(icon => { icon.classList.remove("disabled") });
		if (this.#zoomLevel === 0) document.querySelector(".gantt_headerbar .controls .zoom.zoom_out").classList.add("disabled");
		if (this.#zoomLevel === 3) document.querySelector(".gantt_headerbar .controls .zoom.zoom_in" ).classList.add("disabled");
	}

	//#endregion


	/****************************************************************************/
	//#region Connector Business Logic & Rendering Methods                      */
	/****************************************************************************/

	#AddConnectors() {

		// Remove any existing connectors.
		document.getElementById(`${this.id}_connector_container`).querySelectorAll("path").forEach(path => { if (!path.closest("defs")) path.remove() }); // this excludes the path within the the defs node so we don't lose our arrowhead definition

		// Iterate all points.
		this.#data.forEach(point => {
			if (point.connect.length === 0) return; // no connector for this point
			const chartContainer = document.getElementById(`${this.id}_grid`);

			// Iterate all connections for this point.
			point.connect.forEach(connection => {

				// Validations.
				const rowA = document.getElementById(`${this.id}_${connection.to}_grid_row`);
				const rowB = document.getElementById(`${this.id}_${point.id     }_grid_row`);
				if (rowA.classList.contains("collapsed") || rowB.classList.contains("collapsed")) return; // continue to the next connection iteration if either of the rows are hidden

				const divA = document.getElementById(`${this.id}_${connection.to}_bar`);
				const divB = document.getElementById(`${this.id}_${point.id     }_bar`);
				if (!divA || !divB) return;                                                               // continue to the next connection iteration if we don't have both needed divs to connect

				// Good to go - build the connector.
				const coordsA   = this.#GetOffsetRelativeToAncestor(divA, chartContainer);
				const coordsB   = this.#GetOffsetRelativeToAncestor(divB, chartContainer);
				const terminusA = this.#GetTerminus(coordsA, connection);
				const terminusB = this.#GetTerminus(coordsB, connection, false);
				this.#DrawConnector(connection.type, terminusA, terminusB);
			});
		});
	}

	#GetOffsetRelativeToAncestor(child, ancestor) {
		const childRect    = child.getBoundingClientRect();
		const ancestorRect = ancestor.getBoundingClientRect();
		const relativeTop  = childRect.top  - ancestorRect.top;
		return {
			top   : relativeTop,
			left  : child.offsetLeft,
			height: child.offsetHeight,
			width : child.offsetWidth
		};
	}

	#GetTerminus(coordinates, connection, isTaskA = true) {
		let terminus = {
			top: coordinates.top + (coordinates.height / 2), // for all connection types, top is calculated by subtracting half the height from the top to locate the vertical center
		};
		switch (connection.type) {
			case "SS":
				// For taskA and taskB, left is the left side of the bar.
				terminus.left = coordinates.left;
				break;

			case "FF":
				// For taskA and taskB, left is the right side of the bar.
				terminus.left = coordinates.left + coordinates.width;
				break;

			case "FS":
				// For taskA, left is the left side of the bar, for taskB, left is the right side of the bar.
				terminus.left = isTaskA ? coordinates.left : (coordinates.left + coordinates.width);
				break;

			default:
				// For taskA, left is the right side of the bar; for taskB, left is the left side of the bar.
				terminus.left = isTaskA ? (coordinates.left + coordinates.width) : coordinates.left;
		}
		return terminus;
	}

	#DrawConnector(connectionType, terminusA, terminusB) {
		let line = document.createElementNS("http://www.w3.org/2000/svg", "path");
		line.setAttribute("d"           , this.#CalculatePath(connectionType, terminusA, terminusB));
		line.setAttribute("fill"        , "none"              );
		line.setAttribute("stroke"      , "rgb(100, 100, 100)");
		line.setAttribute("stroke-width", "1"                 );
		line.setAttribute("marker-end", "url(#arrowhead)"     );
		document.getElementById(`${this.id}_connector_container`).appendChild(line);
	}

	#CalculatePath(connectionType, terminusA, terminusB) {
		let current = {
			"left": terminusA.left,
			"top" : terminusA.top
		};
		let path = `M${current.left},${current.top} `;
		switch (connectionType) {
			case "SS": // Start-Start

				// These connectors go from the beginning (left) of taskA to the beginning (left) of taskB.
				// Move horizontally to the left of taskA far enough to be able to connect to taskB.
				current.left = terminusB.left < terminusA.left ? (terminusB.left - 15) : (terminusA.left - 15);
				path        += `H${current.left} `;

				// Move vertically to the correct vertical position for connection with taskB.
				current.top = terminusB.top;
				path       += `V${current.top} `;

				// Move horizontally to connect with taskB.
				current.left = terminusB.left;
				path        += `H${current.left} `;
				break;

			case "FF": // Finish-Finish

				// These connectors go from the end (right) of taskA to the end (right) of taskB.
				// Move horizontally to the right of taskA far enough to be able to connect to taskB.
				current.left = terminusB.left < terminusA.left ? (terminusA.left + 15) : (terminusB.left + 15);
				path        += `H${current.left} `;

				// Move vertically to the correct vertical position for connection with taskB.
				current.top = terminusB.top;
				path       += `V${current.top} `;

				// Move horizontally to connect with taskB.
				current.left = terminusB.left;
				path        += `H${current.left} `;
				break;

			case "FS": // Finish-Start

				// These connectors go from the beginning (left) of taskA to the end (right) of taskB.
				if (terminusB.left + 15 < terminusA.left - 15) {

					// We have enough room between taskA and taskB so there is no need to curve around to taskB.
					// Start by finding the horizontal midpoint between the beginning of taskA and the end of taskB.
					const horizontalMidpoint = (terminusA.left - terminusB.left) / 2;

					// Move horizontally to the correct horizontal position for connection with taskB.
					current.left -= horizontalMidpoint;
					path         += `H${current.left} `;

					// Move vertically to the correct vertical position for connection with taskB.
					current.top = terminusB.top;
					path       += `V${current.top} `;

					// Move horizontally to connect with taskB.
					current.left = terminusB.left;
					path        += `H${current.left} `;

				} else {

					// We do not have enough room between taskA and taskB so we need to curve around to taskB.
					// Start by moving horizontally out from taskA.
					current.left -= 15;
					path         += `H${current.left} `;

					// Move vertically to the base or top of the current row so we can curve around.
					current.top += terminusA.top < terminusB.top ? 12 : -12;
					path        += `V${current.top} `;

					// Move horizontally to a spot that will allow the arrow to connect to taskB.
					current.left = terminusB.left + 15;
					path        += `H${current.left} `;

					// Move vertically to a spot that will allow the arrow to connect to taskB.
					current.top = terminusB.top;
					path       += `V${current.top} `;

					// Move horizontally to connect to taskB.
					current.left = terminusB.left;
					path        += `H${current.left} `;

				}
				break;

			default: // Start-Finish

				// These connectors go from the end (right) of taskA to the beginning (left) of taskB.
				if (terminusA.left + 15 < terminusB.left - 15) {

					// We have enough room between taskA and taskB so there is no need to curve back to taskB.
					// Start by finding the horizontal midpoint between the end of taskA and the beginning of taskB.
					const horizontalMidpoint = (terminusB.left - terminusA.left) / 2;

					// Move horizontally to the correct horizontal position for connection with taskB.
					current.left += horizontalMidpoint;
					path         += `H${current.left} `;

					// Move vertically to the correct vertical position for connection with taskB.
					current.top = terminusB.top;
					path       += `V${current.top} `;

					// Move horizontally to connect with taskB.
					current.left = terminusB.left;
					path        += `H${current.left} `;

				} else {

					// We do not have enough room between taskA and taskB so we need to curve back to taskB.
					// Start by moving horizontally out from taskA.
					current.left += 15;
					path         += `H${current.left} `;

					// Move vertically to the base or top of the current row so we can curve around.
					current.top += terminusA.top < terminusB.top ? 12 : -12;
					path        += `V${current.top} `;

					// Move horizontally back to a spot that will allow the arrow to connect to taskB.
					current.left = terminusB.left - 15;
					path        += `H${current.left} `;

					// Move vertically to a spot that will allow the arrow to connect to taskB.
					current.top = terminusB.top;
					path       += `V${current.top} `;

					// Move horizontally to connect to taskB.
					current.left = terminusB.left;
					path        += `H${current.left} `;
				}
				break;
		}
		return path;
	}

	//#endregion


	/****************************************************************************/
	//#region Event Handlers                                                    */
	/****************************************************************************/

	#SplitterMouseMoveHandler = (e) => { // arrow function so "this" refers to this class instance
		if (this.#resizing) {
			document.getElementById(`${this.id}_grid`).style.overflowX = "hidden"; // horizontal scrollbar was jittery and jumpy while moving, so temporarily hiding it
			this.#moved         = true;
			const dx            = e.movementX;
			const newRightWidth = document.getElementById(`${this.id}_right`).offsetWidth - dx;
			const newLeftWidth  = document.getElementById(`${this.id}_left` ).offsetWidth + dx;
			const totalWidth    = document.getElementById(`${this.id}_left` ).offsetWidth + document.getElementById(`${this.id}_chart`).offsetWidth;
			if (newLeftWidth < totalWidth * .05 || newRightWidth < totalWidth * .05) return; // Stops resizing if width goes below 5% of the container width
			document.getElementById(`${this.id}_left` ).style.width = `${newLeftWidth}px`;
			document.getElementById(`${this.id}_right`).style.width = `${newRightWidth}px`;
		}
	}

	#SplitterMouseUpHandler = (e) => {
		if (!this.#moved) { // user clicked the splitter - reset its position
			const widths = this.#DefaultDivWidths();
			document.getElementById(`${this.id}_left` ).style.width = `${widths.left }px`;
			document.getElementById(`${this.id}_right`).style.width = `${widths.right}px`;
		}
		this.#resizing = false;
		this.#moved    = false;
		document.getElementById(`${this.id}_grid`).style.overflowX = "auto"; // reset the overflow to show or hide it as needed (it gets hidden when the user starts moving the splitter)
		document.removeEventListener("mousemove", this.#SplitterMouseMoveHandler);
		document.removeEventListener("mouseup"  , this.#SplitterMouseUpHandler  );
	}

	//#endregion


	/****************************************************************************/
	//#region Utilities                                                         */
	/****************************************************************************/

	#SynchronizeScroll(control) {
		document.getElementById(`${control.id}_header`).scrollLeft = control.scrollLeft; // whether we're scrolling the left or right side, keep its header div in sync horizontally
		if (control.id === `${this.id}_chart`) {			                             // if we're scrolling the right side, keep the left side in sync vertically
			let leftDiv       = document.getElementById(`${this.id}_grid` );
			let rightDiv      = document.getElementById(`${this.id}_chart`);
			leftDiv.scrollTop = control.scrollTop;
			if (leftDiv.scrollTop != rightDiv.scrollTop) {                               // this happens if only one horizontal scrollbar is visible - in this case, apply the minimum scrollTop so the rows stay even with each other
				const minScrollTop = Math.min(leftDiv.scrollTop, rightDiv.scrollTop)
				leftDiv.scrollTop  = minScrollTop;
				rightDiv.scrollTop = minScrollTop;
			}
		}
	}

	#GetVerticalScrollBarWidth() {

		// Since different systems can have vertical scrollbars of different widths, here we actually create an invisible div with a scrollbar, measure it, remove it, and return the value.
		const outer = document.createElement("div");
		outer.style.visibility = "hidden";
		outer.style.overflowY  = "scroll";
		document.body.appendChild(outer);
		const inner = document.createElement("div");
		outer.appendChild(inner);
		const scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
		document.body.removeChild(outer);
		return scrollbarWidth + 1; // plus 1 pixel to be sure we don't get a horizontal scrollbar that doesn't scroll
	}

	//#endregion


	/****************************************************************************/
	//#region Public Methods                                                    */
	/****************************************************************************/

	Init() {

		// Add event handlers needed to deal with viewport or layout changes.
		window.addEventListener('resize', () => {                                   // after a viewport resize (timer ensures this doesn't happen to often/quickly)
			clearTimeout(this.#timer);
			this.#timer = setTimeout(() => { this.#RefreshGrid(null, true) }, 500); // outer lambda function executes immediately and preserves "this" - inner setTimeout() executes the refresh after the delay
		});

		// Build the Gantt chart.
		this.#RefreshGrid();
	}

	ToggleRowExpansion(pointId) {

		// Grab the current scrollTop value before setting to 0 - this is needed so the positioning of the connectors is accurate when redrawn.
		let   chartControl = document.getElementById(`${this.id}_chart`);
		const scrollTop    = chartControl.scrollTop;
		chartControl.scrollTop = 0;

		// Style the rows.
		let expanded = true;
		document.querySelectorAll(`.${this.id}_parent_id_${pointId}`).forEach(row => {
			if (row.classList.contains("expanded")) {
				expanded = false;
				row.classList.remove("expanded" );
				row.classList.add(   "collapsed");
			} else {
				row.classList.remove("collapsed");
				row.classList.add(   "expanded" );
			}
		});

		// Update the caret & reraw the connectors.
		document.getElementById(`${this.id}_${pointId}_row_toggle`).innerHTML = this.#GetCaret(expanded);
		this.#AddConnectors();

		// Finally, reset the scrollTop back to what it was and re-sync the scroll.
		chartControl.scrollTop = scrollTop;
		this.#SynchronizeScroll(chartControl);
	}

	ExpandAllSections(expand = true) {
		this.#data.forEach(point => {
			const isParent = (point.hasOwnProperty("parent") && point.parent !== null) ? false : true;
			if (!isParent) return; // not a parent - continue to the next iteration
			document.querySelectorAll(`.${this.id}_parent_id_${point.id}`).forEach(row => {
				row.classList.remove(expand ? "collapsed" : "expanded" );
				row.classList.add(   expand ? "expanded"  : "collapsed");
			});
			document.getElementById(`${this.id}_${point.id}_row_toggle`).innerHTML = this.#GetCaret(expand);
		});
		this.#AddConnectors();
	}

	Zoom(zoomIn = true) {

		// Calculate new zoom level.
		let newZoomLevel = this.#zoomLevel + (zoomIn ? 1 : -1);
		if (newZoomLevel < 0) newZoomLevel = 0;
		if (3 < newZoomLevel) newZoomLevel = 3;

		// Update the zoom level and refresh the grid.
		if (newZoomLevel !== this.#zoomLevel) {
			this.zoomLevel = newZoomLevel;
			this.#RefreshGrid();
		}
	}

	//#endregion
}

//#endregion