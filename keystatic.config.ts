import { config, fields, singleton, collection } from '@keystatic/core';

export default config({
	storage: {
		kind: 'local',
	},
	singletons: {
		startseite: singleton({
			label: 'Startseite',
			path: 'src/content/startseite/index',
			format: { contentField: 'ueber_uns_text' },
			schema: {
				hero_headline: fields.text({
					label: 'Hero Headline',
					validation: { isRequired: true },
				}),
				hero_subline: fields.text({
					label: 'Hero Subline',
					multiline: true,
				}),
				hero_cta_primaer: fields.text({
					label: 'Hero CTA (primär)',
					defaultValue: 'Kostenlose Anfrage',
				}),
				hero_cta_sekundaer: fields.text({
					label: 'Hero CTA (sekundär)',
					defaultValue: 'Leistungen ansehen',
				}),
				ueber_uns_text: fields.markdoc({
					label: 'Über-uns-Text',
				}),
				telefonnummer: fields.text({
					label: 'Telefonnummer',
					validation: { isRequired: true },
				}),
				email: fields.text({
					label: 'E-Mail',
					validation: { isRequired: true },
				}),
				adresse: fields.text({
					label: 'Adresse',
					multiline: true,
				}),
				meta_title: fields.text({
					label: 'Meta Title',
					validation: { isRequired: true, length: { max: 60 } },
				}),
				meta_description: fields.text({
					label: 'Meta Description',
					multiline: true,
					validation: { isRequired: true, length: { max: 160 } },
				}),
			},
		}),
	},
	collections: {
		leistungen: collection({
			label: 'Leistungen',
			slugField: 'titel',
			path: 'src/content/leistungen/*',
			format: { contentField: 'haupttext' },
			schema: {
				titel: fields.slug({
					name: {
						label: 'Titel',
						validation: { isRequired: true },
					},
				}),
				icon_name: fields.select({
					label: 'Icon',
					options: [
						{ label: 'Sparkles (Grundreinigung)', value: 'sparkle' },
						{ label: 'Brush (Unterhaltsreinigung)', value: 'broom' },
						{ label: 'Building2 (Büroreinigung)', value: 'building' },
						{ label: 'AppWindow (Fensterreinigung)', value: 'window' },
						{ label: 'KeyRound (Hotel-/Gewerbereinigung)', value: 'key' },
						{ label: 'Stairs (Treppenhausreinigung)', value: 'stairs' },
						{ label: 'GraduationCap (Schulen/Kindergarten)', value: 'school' },
						{ label: 'Cross (Praxis/Krankenhaus)', value: 'medical' },
					],
					defaultValue: 'sparkle',
				}),
				kurzbeschreibung: fields.text({
					label: 'Kurzbeschreibung',
					multiline: true,
					validation: { isRequired: true, length: { max: 160 } },
				}),
				haupttext: fields.markdoc({
					label: 'Haupttext',
				}),
				reihenfolge: fields.integer({
					label: 'Reihenfolge',
					defaultValue: 1,
				}),
			},
		}),
	},
});
