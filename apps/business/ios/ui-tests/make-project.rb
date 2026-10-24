# بنولّد مشروع الاختبار على الـ runner عشان مفيش Mac يعدّل مشروع Xcode، وعشان `App.xcodeproj`
# ممنوع يتعدّل بالإيد. مكتبة `xcodeproj` جاية مع CocoaPods على صورة الـ macOS runner.
require 'xcodeproj'

out_dir = ARGV[0] || abort('Usage: ruby apps/business/ios/ui-tests/make-project.rb <output-dir>')

project = Xcodeproj::Project.new(File.join(out_dir, 'SpikeUITests.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'SpikeUITests', :ios, '15.0')
group = project.main_group.new_group('SpikeUITests')
source = group.new_file(File.expand_path('SpikeUITests.swift', __dir__))
target.add_file_references([source])
target.build_configurations.each do |config|
  settings = config.build_settings
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'systems.pospay.business.spike-ui-tests'
  settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  settings['SWIFT_VERSION'] = '5.0'
  settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  settings['CODE_SIGN_STYLE'] = 'Manual'
  settings['CODE_SIGN_IDENTITY'] = '-'
  settings['DEVELOPMENT_TEAM'] = ''
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_test_target(target)
scheme.save_as(project.path, 'SpikeUITests', true)
