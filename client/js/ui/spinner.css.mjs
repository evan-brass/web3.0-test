import css from '../../../extern/js-min/src/templating/css.mjs';

export default css`
.spinner > span {
	display: inline-block;
	position: relative;
	width: 1em;
	height: 1em;
}
.spinner.running {
	color: #333;
}
.spinner.completed {
	color: #02c39a;
}
.spinner.errored {
	color: tomato;
}
.spinner > span::before, .spinner > span::after {
	/* transition: border-color .5s, transform .5s; */
	box-sizing: border-box;
	top: 0;
	position: absolute;
	content: "";
	display: inline-block;
	height: 100%;
	animation-duration: 1s;
	animation-fill-mode: forwards;
	/* Shared by dormant, completed and running: */
	width: 100%;
	left: 0;
	background: transparent;
	border: 2px solid #ccc;
	border-radius: 50%;
}
/* Dormant: */
.spinner.dormant > span::after {
	display: none;
}
/* Running: */
.spinner.running > span::after {
	animation-name: spinner-run-after;
	animation-iteration-count: infinite;
	animation-timing-function: cubic-bezier(0.35, -0.19, 0.43, 1.24);
	/* animation-timing-function: cubic-bezier(.48,-0.34,.61,.93); */
}
@keyframes spinner-run-after {
	from {
		transform: rotate(0);
	}
	to {
		transform: rotate(360deg);
	}
}
.spinner.running > span::after {
	border-color: transparent;
	border-bottom-color: #333;
}

/* Completed: */
.spinner.completed > span::before {
	left: 0;
	animation-name: spinner-completed-before;
}
.spinner.completed > span::after {
	display: none;
}
@keyframes spinner-completed-before {
	to {
		border-color: #02c39a;
		border-radius: 50%;
	}
}

/* Errored: */
.spinner.errored > span::before, .spinner.errored > span::after {
	width: unset;
	border: unset;
	left: calc(50% - 1px);
	border-left: 2px solid;
	border-radius: unset;
}
.spinner.errored > span::before {
	animation-name: spinner-er-before;
}
.spinner.errored > span::after {
	animation-name: spinner-er-after;
}
@keyframes spinner-er-before {
	from {
		transform: rotate(0);
		border-color: #eee;
	}
	to {
		transform: rotate(45deg);
		border-color: tomato;
	}
}
@keyframes spinner-er-after {
	from {
		transform: rotate(0);
		border-color: #eee;
	}
	to {
		transform: rotate(-45deg);
		border-color: tomato;
	}
}
`;