import css from '../../extern/js-min/src/templating/css.mjs';

// TODO: Switch to importing main.css from another module.

export default css`
/*
font-family: 'Merriweather', serif;
font-family: 'Lora', serif;
*/
:host {
	display: block;
}
ul {
	padding: 0;
}
li {
	display: block;
	list-style: none;
}
#self-info div {
	border: 1px dashed;
	overflow-wrap: break-word;
}

summary {
	padding-block: .5em;
}
`;